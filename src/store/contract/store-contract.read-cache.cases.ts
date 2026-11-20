import { contextOver, stageAll, withA, withAB } from './store-contract.attribute-query.cases'
import { COMMITTED, DOCUMENT_ID } from './store-contract.attribute-query.constants'
import { makeDocument, makeRecord } from './store-contract.fixtures'

import { expect } from 'vitest'

import { findByAttributes, getRecord } from '@/document'
import { createTransactionReadCache } from '@/document/transaction-read-cache'
import { COMPLETE_TAG_AT_LOOKUP } from '@/document/transaction-read-cache.constants'
import { XSD_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers'
import { createPerf } from '@/perf'
import { DIALECTE_TEST_NAMESPACES } from '@/test'

import type { Store } from '../store.types'
import type { Answer, Staging } from './store-contract.attribute-query.types'
import type { StoreContractCases, StoreContractGroups } from './store-contract.types'
import type { AnyRawRecord } from '@/types'

/**
 * The answer of `findByAttributes` on the store holding `seeded`, after `staging`, in a transaction with its read
 * cache: asked first (the store's lookup), then again once lookups of other values read the tag whole (from memory),
 * with the store reads the second ask took.
 */
async function answersAroundCompletion(params: {
	store: Store
	seeded: AnyRawRecord[]
	staging?: Staging
	tagName?: string
	/** The attribute the lookups that read the tag whole ask (values no record holds). */
	padAttribute?: string
	/** A record of the tag read alone before the first ask. */
	readFirst?: string
	attributes: Record<string, unknown>
}): Promise<{ fromStore: Answer; fromMemory: Answer; secondAskReads: number }> {
	const {
		store,
		seeded,
		staging = () => {},
		tagName = 'A',
		padAttribute = 'aA',
		readFirst,
		attributes,
	} = params
	await store.registerDocument(makeDocument())
	await store.bulkWrite(DOCUMENT_ID, { creates: seeded })
	const perf = createPerf({ enabled: true })
	const readCache = createTransactionReadCache()
	// the context a transaction gives its reads: its record cache is its read cache's records
	const context = {
		...contextOver({ store, perf }),
		recordCache: readCache.records,
		readCache,
	} as ReturnType<typeof contextOver>
	stageAll({ context, seeded, staging })
	if (readFirst) await getRecord({ context, ref: { tagName: tagName as never, id: readFirst } })
	async function ask(filter: Record<string, unknown>): Promise<Answer> {
		const records = await findByAttributes({
			context,
			tagName: tagName as never,
			attributes: filter as never,
		})
		return records.map((record) => `${record.id}:${record.status}`)
	}
	const fromStore = await ask(attributes)
	for (let index = 1; index < COMPLETE_TAG_AT_LOOKUP; index++) {
		await ask({ [padAttribute]: `pad-${index}` })
	}
	const before = storeReads(perf.report())
	const fromMemory = await ask(attributes)
	return { fromStore, fromMemory, secondAskReads: storeReads(perf.report()) - before }
}

/** The store reads counted in a perf report: lookups and tag reads. */
function storeReads(report: Record<string, { count?: number } | undefined>): number {
	return (
		(report['core::store::getByAttributes']?.count ?? 0) +
		(report['core::store::getByTagName']?.count ?? 0)
	)
}

/** One case: the seeded records, the staged writes and the filter asked around completion. */
function aroundCompletion(params: {
	seeded?: AnyRawRecord[]
	staging?: Staging
	tagName?: string
	padAttribute?: string
	readFirst?: string
	attributes: Record<string, unknown>
	expected: Answer
}): StoreContractCases[string] {
	const { seeded = COMMITTED, expected, ...asked } = params
	return {
		act: async ({ store }) => {
			const answers = await answersAroundCompletion({ store, seeded, ...asked })
			expect(answers.fromStore).toEqual(expected)
			expect(answers.fromMemory).toEqual(answers.fromStore)
			expect(answers.secondAskReads).toBe(0)
		},
	}
}

const aroundCompletionCases: StoreContractCases = {
	'committed records only → the same records in id order, the second ask from memory':
		aroundCompletion({
			attributes: { aA: 'v' },
			expected: ['c:unchanged', 'x:unchanged'],
		}),
	'a create staged → after the committed records, from memory too': aroundCompletion({
		staging: (stage) => stage({ status: 'created', record: withA('b', 'v') }),
		attributes: { aA: 'v' },
		expected: ['c:unchanged', 'x:unchanged', 'b:created'],
	}),
	'an update into the filter, one out of it, and a delete → as the store answers': aroundCompletion(
		{
			seeded: [...COMMITTED, withA('z', 'v')],
			staging: (stage) => {
				stage({ status: 'updated', record: withA('m', 'v') })
				stage({ status: 'updated', record: withA('c', 'w') })
				stage({ status: 'deleted', record: withA('x', 'v') })
			},
			attributes: { aA: 'v' },
			expected: ['m:updated', 'z:unchanged'],
		},
	),
	'a committed record deleted then created again → at the end, from memory too': aroundCompletion({
		staging: (stage) => {
			stage({ status: 'deleted', record: withA('c', 'v') })
			stage({ status: 'created', record: withA('c', 'v') })
		},
		attributes: { aA: 'v' },
		expected: ['x:unchanged', 'c:created'],
	}),
	'a value list → the records holding any of the values': aroundCompletion({
		attributes: { aA: ['v', 'w'] },
		expected: ['c:unchanged', 'm:unchanged', 'x:unchanged'],
	}),
	'two attributes → the records holding both': aroundCompletion({
		seeded: [withAB('p', 'one'), withAB('q', 'two'), withA('r', 'v')],
		attributes: { aA: 'v', bA: 'one' },
		expected: ['p:unchanged'],
	}),
	'a value no record holds → none, from memory too': aroundCompletion({
		attributes: { aA: 'none' },
		expected: [],
	}),
	'a record read alone before the tag completes → the same records, from memory too':
		aroundCompletion({
			readFirst: 'x',
			attributes: { aA: 'v' },
			expected: ['c:unchanged', 'x:unchanged'],
		}),
	'a committed record moved under another parent → in its place, from memory too': aroundCompletion(
		{
			staging: (stage) =>
				stage({
					status: 'updated',
					record: { ...withA('c', 'v'), parent: { id: 'elsewhere', tagName: 'Root' } },
				}),
			attributes: { aA: 'v' },
			expected: ['c:updated', 'x:unchanged'],
		},
	),
	'a foreign attribute before a plain one of the same name → answered by the first one, from memory too':
		aroundCompletion({
			seeded: [
				makeRecord({
					id: 'r1',
					attributes: [
						{ name: 'aA', value: 'v', namespace: { prefix: 'f', uri: 'urn:f' } },
						{ name: 'aA', value: 'w' },
					],
				}),
				makeRecord({
					id: 'r2',
					attributes: [
						{ name: 'aA', value: 'w' },
						{ name: 'aA', value: 'v', namespace: { prefix: 'f', uri: 'urn:f' } },
					],
				}),
			],
			attributes: { aA: 'v' },
			expected: ['r1:unchanged'],
		}),
	'an attribute of another namespace → the records holding it, from memory too': aroundCompletion({
		seeded: [
			makeRecord({
				id: 'r1',
				attributes: [{ name: 'ext:cA', value: 'Z', namespace: DIALECTE_TEST_NAMESPACES.ext }],
			}),
			makeRecord({ id: 'r2', attributes: [{ name: 'aA', value: 'Z' }] }),
		],
		attributes: { 'ext:cA': 'Z' },
		expected: ['r1:unchanged'],
	}),
	'an xsi:type in another form than stored, beside a plain attribute → matched by type, from memory too':
		aroundCompletion({
			seeded: ['tDD_1A', 'tDD_1B'].map((type, index) =>
				makeRecord({
					id: `d${index + 1}`,
					tagName: 'DD_1',
					attributes: [
						{ name: 'xsi:type', value: type, namespace: XSI_NAMESPACE },
						{ name: 'aDD_1', value: 's' },
					],
				}),
			),
			tagName: 'DD_1',
			padAttribute: 'aDD_1',
			attributes: { 'xsi:type': `{${DIALECTE_TEST_NAMESPACES.default.uri}}tDD_1A`, aDD_1: 's' },
			expected: ['d1:unchanged'],
		}),
	'a QName-typed value by its Clark name, beside a plain attribute → the record holding its stored form, from memory too':
		aroundCompletion({
			seeded: ['xs:integer', 'xs:string'].map((value, index) =>
				makeRecord({
					id: `q${index + 1}`,
					tagName: 'EE_1',
					// the record's definition is read in the dialecte's namespace only
					namespace: DIALECTE_TEST_NAMESPACES.default,
					parent: { id: 'e', tagName: 'E' },
					attributes: [
						{ name: 'aEE_1', value },
						{ name: 'bEE_1', value: 's' },
					],
				}),
			),
			tagName: 'EE_1',
			padAttribute: 'bEE_1',
			attributes: { aEE_1: `{${XSD_NAMESPACE_URI}}integer`, bEE_1: 's' },
			expected: ['q1:unchanged'],
		}),
}

/** A transaction's lookups answered from a tag read whole: the records the store's lookup gives, in the same order. */
export const STORE_READ_CACHE_CONTRACT: StoreContractGroups = {
	'attribute queries answered from a tag read whole': aroundCompletionCases,
}
