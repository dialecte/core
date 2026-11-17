import { makeDocument, makeRecord } from './store-contract.fixtures'

import { expect } from 'vitest'

import { createStagedOperations, findByAttributes } from '@/document'
import { NOOP_PROGRESS_REPORTER } from '@/document/progress'
import { stageOperation } from '@/document/transaction/stage-operations'
import { XSD_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers'
import { createPerf } from '@/perf'
import { DIALECTE_TEST_NAMESPACES, TEST_DIALECTE_CONFIG } from '@/test'

import type { Store } from '../store.types'
import type { StoreContractCases, StoreContractGroups } from './store-contract.types'
import type { Context } from '@/document'
import type { Perf } from '@/perf'
import type { TestDialecteConfig } from '@/test'
import type { AnyAttribute, AnyRawRecord } from '@/types'

const DOCUMENT_ID = 'doc-1'

/** What a case stages in its transaction, on a context over the store. */
type Staging = (stage: Stager) => void

/** Stage one write: a create or a delete of `record`, an update from the held version to `record`. */
type Stager = (params: { status: 'created' | 'updated' | 'deleted'; record: AnyRawRecord }) => void

/** An answer as a case compares it: each record's id and status, in the order answered. */
type Answer = string[]

/** A record of tag `A` (unless another is named) holding these attributes. */
function recordWith(params: {
	id: string
	attributes: AnyAttribute[]
	tagName?: string
	parent?: AnyRawRecord['parent']
}): AnyRawRecord {
	const { id, attributes, tagName = 'A', parent = null } = params
	return makeRecord({ id, tagName, attributes, parent })
}

/** A record of tag `A` holding `aA` with that value. */
function withA(id: string, value: string): AnyRawRecord {
	return recordWith({ id, attributes: [{ name: 'aA', value }] })
}

/** A record of tag `A` holding `aA="v"` and `bA` with that value. */
function withAB(id: string, value: string): AnyRawRecord {
	return recordWith({
		id,
		attributes: [
			{ name: 'aA', value: 'v' },
			{ name: 'bA', value },
		],
	})
}

/** The store as it is, without `getByAttributes`: what a store that has none answers through the query layer. */
function withoutLookup(store: Store): Store {
	return new Proxy(store, {
		get: function memberOfStore(target, property) {
			if (property === 'getByAttributes') return undefined
			const member: unknown = Reflect.get(target, property, target)
			return typeof member === 'function' ? member.bind(target) : member
		},
	})
}

/** A transaction's context over the store: its staged writes empty, its cache on, its store reads counted. */
function contextOver(params: { store: Store; perf: Perf }): Context<TestDialecteConfig> {
	const { store, perf } = params
	return {
		store,
		dialecteConfig: TEST_DIALECTE_CONFIG,
		documentId: DOCUMENT_ID,
		kind: 'transaction',
		recordCache: new Map(),
		stagedOperations: createStagedOperations<TestDialecteConfig>(),
		progress: NOOP_PROGRESS_REPORTER,
		perf,
	} as unknown as Context<TestDialecteConfig>
}

/** Stage each write of `staging` on the context, an update from the version the store or an earlier write holds. */
function stageAll(params: {
	context: Context<TestDialecteConfig>
	seeded: AnyRawRecord[]
	staging: Staging
}): void {
	const { context, seeded, staging } = params
	const held = new Map(seeded.map((record) => [record.id, record]))
	staging(function stage({ status, record }) {
		if (status === 'updated') {
			const oldRecord = held.get(record.id) ?? record
			stageOperation({ context, status, oldRecord: oldRecord as never, newRecord: record as never })
		} else if (status === 'created') stageOperation({ context, status, record: record as never })
		else stageOperation({ context, status, record: record as never })
		held.set(record.id, record)
	})
}

/**
 * The answer of `findByAttributes` on the store holding `seeded`, after `staging` in a transaction - once on the
 * store, once on the store without its lookup - with the store reads of each.
 */
async function answersBothWays(params: {
	store: Store
	seeded: AnyRawRecord[]
	staging?: Staging
	tagName?: string
	attributes: Record<string, unknown>
}): Promise<{ withLookup: Answer; withoutLookup: Answer; reads: Record<string, number> }> {
	const { store, seeded, staging = () => {}, tagName = 'A', attributes } = params
	await store.registerDocument(makeDocument())
	await store.bulkWrite(DOCUMENT_ID, { creates: seeded })
	async function answerOn(onStore: Store): Promise<{ answer: Answer; perf: Perf }> {
		const perf = createPerf({ enabled: true })
		const context = contextOver({ store: onStore, perf })
		stageAll({ context, seeded, staging })
		const records = await findByAttributes({
			context,
			tagName: tagName as never,
			attributes: attributes as never,
		})
		// every record a transaction read from the store is in its cache, as with a tag read
		for (const record of records) {
			if (record.status === 'unchanged') expect(context.recordCache?.has(record.id)).toBe(true)
		}
		return { answer: records.map((record) => `${record.id}:${record.status}`), perf }
	}
	const first = await answerOn(store)
	const second = await answerOn(withoutLookup(store))
	const report = first.perf.report()
	const reads = Object.fromEntries(
		['core::store::getByAttributes', 'core::store::getByTagName'].map((name) => [
			name.slice('core::store::'.length),
			report[name]?.count ?? 0,
		]),
	)
	return { withLookup: first.answer, withoutLookup: second.answer, reads }
}

/** The store read one lookup takes: its attribute lookup when it has one, else its tag read. */
function oneReadOf(store: Store): Record<string, number> {
	return store.getByAttributes
		? { getByAttributes: 1, getByTagName: 0 }
		: { getByAttributes: 0, getByTagName: 1 }
}

const COMMITTED = [withA('x', 'v'), withA('c', 'v'), withA('m', 'w')]

const staged: StoreContractCases = {
	'a create staged → answered after the committed records, as without the lookup': {
		act: async ({ store }) => {
			const answers = await answersBothWays({
				store,
				seeded: COMMITTED,
				staging: (stage) => stage({ status: 'created', record: withA('b', 'v') }),
				attributes: { aA: 'v' },
			})
			expect(answers.withLookup).toEqual(['c:unchanged', 'x:unchanged', 'b:created'])
			expect(answers.withLookup).toEqual(answers.withoutLookup)
			expect(answers.reads).toEqual(oneReadOf(store))
		},
	},
	'an update staged making a committed record match → in id order among the committed': {
		act: async ({ store }) => {
			const answers = await answersBothWays({
				store,
				seeded: COMMITTED,
				staging: (stage) => stage({ status: 'updated', record: withA('m', 'v') }),
				attributes: { aA: 'v' },
			})
			expect(answers.withLookup).toEqual(['c:unchanged', 'm:updated', 'x:unchanged'])
			expect(answers.withLookup).toEqual(answers.withoutLookup)
			expect(answers.reads).toEqual(oneReadOf(store))
		},
	},
	'an update staged making a committed record not match, and a delete → both gone': {
		act: async ({ store }) => {
			const answers = await answersBothWays({
				store,
				seeded: [...COMMITTED, withA('z', 'v')],
				staging: (stage) => {
					stage({ status: 'updated', record: withA('c', 'w') })
					stage({ status: 'deleted', record: withA('x', 'v') })
				},
				attributes: { aA: 'v' },
			})
			expect(answers.withLookup).toEqual(['z:unchanged'])
			expect(answers.withLookup).toEqual(answers.withoutLookup)
			expect(answers.reads).toEqual(oneReadOf(store))
		},
	},
	'a committed record deleted then created again → answered at the end': {
		act: async ({ store }) => {
			const answers = await answersBothWays({
				store,
				seeded: COMMITTED,
				staging: (stage) => {
					stage({ status: 'deleted', record: withA('c', 'v') })
					stage({ status: 'created', record: withA('c', 'v') })
					stage({ status: 'created', record: withA('a', 'v') })
				},
				attributes: { aA: 'v' },
			})
			expect(answers.withLookup).toEqual(['x:unchanged', 'c:created', 'a:created'])
			expect(answers.withLookup).toEqual(answers.withoutLookup)
			expect(answers.reads).toEqual(oneReadOf(store))
		},
	},
	'a create, then a later create, then the first updated to match → in its place': {
		act: async ({ store }) => {
			const answers = await answersBothWays({
				store,
				seeded: COMMITTED,
				staging: (stage) => {
					stage({ status: 'created', record: withA('b', 'w') })
					stage({ status: 'created', record: withA('a', 'v') })
					stage({ status: 'updated', record: withA('b', 'v') })
				},
				attributes: { aA: 'v' },
			})
			expect(answers.withLookup).toEqual(['c:unchanged', 'x:unchanged', 'b:updated', 'a:created'])
			expect(answers.withLookup).toEqual(answers.withoutLookup)
			expect(answers.reads).toEqual(oneReadOf(store))
		},
	},
	'a create updated then deleted, updates matched on a second attribute → only the update both attributes match':
		{
			act: async ({ store }) => {
				const answers = await answersBothWays({
					store,
					seeded: COMMITTED,
					staging: (stage) => {
						stage({ status: 'created', record: withA('b', 'v') })
						stage({ status: 'updated', record: withA('b', 'v') })
						stage({ status: 'deleted', record: withA('b', 'v') })
						stage({ status: 'updated', record: withAB('m', 'no') })
						stage({ status: 'updated', record: withAB('x', 'yes') })
					},
					attributes: { aA: 'v', bA: 'yes' },
				})
				expect(answers.withLookup).toEqual(['x:updated'])
				expect(answers.withLookup).toEqual(answers.withoutLookup)
				expect(answers.reads).toEqual(oneReadOf(store))
			},
		},
	'an update staged removing the queried attribute of a committed record → it is gone': {
		act: async ({ store }) => {
			const answers = await answersBothWays({
				store,
				seeded: COMMITTED,
				staging: (stage) =>
					stage({ status: 'updated', record: recordWith({ id: 'c', attributes: [] }) }),
				attributes: { aA: 'v' },
			})
			expect(answers.withLookup).toEqual(['x:unchanged'])
			expect(answers.withLookup).toEqual(answers.withoutLookup)
			expect(answers.reads).toEqual(oneReadOf(store))
		},
	},
}

const filters: StoreContractCases = {
	"'' never matches, alone or in a list": {
		act: async ({ store }) => {
			const seeded = [withA('e', ''), withA('x', 'v'), recordWith({ id: 'n', attributes: [] })]
			const alone = await answersBothWays({ store, seeded, attributes: { aA: '' } })
			await store.removeDocument(DOCUMENT_ID)
			const listed = await answersBothWays({ store, seeded, attributes: { aA: ['', 'v'] } })
			expect({ alone: alone.withLookup, listed: listed.withLookup }).toEqual({
				alone: [],
				listed: ['x:unchanged'],
			})
			expect(alone.withLookup).toEqual(alone.withoutLookup)
			expect(listed.withLookup).toEqual(listed.withoutLookup)
			expect({ alone: alone.reads, listed: listed.reads }).toEqual({
				alone: { getByAttributes: 0, getByTagName: 0 },
				listed: oneReadOf(store),
			})
		},
	},
	'an xsi:type filter in another form than stored, beside a plain attribute → matched by type': {
		act: async ({ store }) => {
			function typed(id: string, type: string): AnyRawRecord {
				return recordWith({
					id,
					tagName: 'DD_1',
					attributes: [
						{ name: 'xsi:type', value: type, namespace: XSI_NAMESPACE },
						{ name: 'aDD_1', value: 's' },
					],
				})
			}
			const answers = await answersBothWays({
				store,
				seeded: [typed('d1', 'tDD_1A'), typed('d2', 'tDD_1B')],
				tagName: 'DD_1',
				attributes: {
					'xsi:type': `{${DIALECTE_TEST_NAMESPACES.default.uri}}tDD_1A`,
					aDD_1: 's',
				},
			})
			expect(answers.withLookup).toEqual(['d1:unchanged'])
			expect(answers.withLookup).toEqual(answers.withoutLookup)
			expect(answers.reads).toEqual(oneReadOf(store))
		},
	},
	'a QName-typed attribute filtered by its Clark name → the record holding its stored form': {
		act: async ({ store }) => {
			function qualified(id: string, value: string): AnyRawRecord {
				return makeRecord({
					id,
					tagName: 'EE_1',
					// the record's definition is read in the dialecte's namespace only
					namespace: DIALECTE_TEST_NAMESPACES.default,
					parent: { id: 'e', tagName: 'E' },
					attributes: [{ name: 'aEE_1', value }],
				})
			}
			const answers = await answersBothWays({
				store,
				seeded: [qualified('q1', 'xs:integer'), qualified('q2', 'xs:string')],
				tagName: 'EE_1',
				attributes: { aEE_1: `{${XSD_NAMESPACE_URI}}integer` },
			})
			expect(answers.withLookup).toEqual(['q1:unchanged'])
			expect(answers.withLookup).toEqual(answers.withoutLookup)
			// nothing to push: the tag read and filtered
			expect(answers.reads).toEqual({ getByAttributes: 0, getByTagName: 1 })
		},
	},
	'a foreign attribute before a plain one of the same name → answered by the first one': {
		act: async ({ store }) => {
			const foreign = { prefix: 'f', uri: 'urn:f' }
			const seeded = [
				recordWith({
					id: 'r1',
					attributes: [
						{ name: 'aA', value: 'v', namespace: foreign },
						{ name: 'aA', value: 'w' },
					],
				}),
				recordWith({
					id: 'r2',
					attributes: [
						{ name: 'aA', value: 'w' },
						{ name: 'aA', value: 'v', namespace: foreign },
					],
				}),
			]
			const byV = await answersBothWays({ store, seeded, attributes: { aA: 'v' } })
			await store.removeDocument(DOCUMENT_ID)
			const byW = await answersBothWays({ store, seeded, attributes: { aA: 'w' } })
			expect({ byV: byV.withLookup, byW: byW.withLookup }).toEqual({
				byV: ['r1:unchanged'],
				byW: ['r2:unchanged'],
			})
			expect(byV.withLookup).toEqual(byV.withoutLookup)
			expect(byW.withLookup).toEqual(byW.withoutLookup)
			expect(byV.reads).toEqual(oneReadOf(store))
		},
	},
	'a list of values, one named twice → one store read, each record once': {
		act: async ({ store }) => {
			const seeded = Array.from({ length: 6 }, (_, index) => withA(`r${index}`, `v${index}`))
			const answers = await answersBothWays({
				store,
				seeded,
				attributes: { aA: ['v4', 'v1', 'v1', 'v2', 'none'] },
			})
			expect(answers.withLookup).toEqual(['r1:unchanged', 'r2:unchanged', 'r4:unchanged'])
			expect(answers.withLookup).toEqual(answers.withoutLookup)
			expect(answers.reads).toEqual(oneReadOf(store))
		},
	},
	'an empty list → nothing, as without the lookup': {
		act: async ({ store }) => {
			const answers = await answersBothWays({
				store,
				seeded: COMMITTED,
				staging: (stage) => stage({ status: 'created', record: withA('b', 'v') }),
				attributes: { aA: [], bA: undefined },
			})
			expect(answers.withLookup).toEqual([])
			expect(answers.withLookup).toEqual(answers.withoutLookup)
			// an attribute no value can match: no read
			expect(answers.reads).toEqual({ getByAttributes: 0, getByTagName: 0 })
		},
	},
}

/** `findByAttributes` over any store: the same records in the same order, with its lookup or without. */
export const STORE_ATTRIBUTE_QUERY_CONTRACT: StoreContractGroups = {
	'attribute queries over staged writes': staged,
	'attribute query filters': filters,
}
