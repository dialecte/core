import {
	COMMITTED,
	contextOver,
	stageAll,
	withA,
	withAB,
} from './store-contract.attribute-query.cases'
import { makeDocument } from './store-contract.fixtures'

import { expect } from 'vitest'

import { findByAttributes } from '@/document'
import { createTransactionReadCache } from '@/document/transaction-read-cache'
import { COMPLETE_TAG_AT_LOOKUP } from '@/document/transaction-read-cache.constants'
import { createPerf } from '@/perf'

import type { Store } from '../store.types'
import type { Answer, Staging } from './store-contract.attribute-query.cases'
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
	attributes: Record<string, unknown>
}): Promise<{ fromStore: Answer; fromMemory: Answer; secondAskReads: number }> {
	const { store, seeded, staging = () => {}, attributes } = params
	await store.registerDocument(makeDocument())
	await store.bulkWrite('doc-1', { creates: seeded })
	const perf = createPerf({ enabled: true })
	const readCache = createTransactionReadCache()
	// the context a transaction gives its reads: its record cache is its read cache's records
	const context = {
		...contextOver({ store, perf }),
		recordCache: readCache.records,
		readCache,
	} as ReturnType<typeof contextOver>
	stageAll({ context, seeded, staging })
	async function ask(filter: Record<string, unknown>): Promise<Answer> {
		const records = await findByAttributes({ context, tagName: 'A', attributes: filter as never })
		return records.map((record) => `${record.id}:${record.status}`)
	}
	const fromStore = await ask(attributes)
	for (let index = 1; index < COMPLETE_TAG_AT_LOOKUP; index++) {
		await ask({ aA: `pad-${index}` })
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
	attributes: Record<string, unknown>
	expected: Answer
}): StoreContractCases[string] {
	const { seeded = COMMITTED, staging, attributes, expected } = params
	return {
		act: async ({ store }) => {
			const answers = await answersAroundCompletion({ store, seeded, staging, attributes })
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
}

/** A transaction's lookups answered from a tag read whole: the records the store's lookup gives, in the same order. */
export const STORE_READ_CACHE_CONTRACT: StoreContractGroups = {
	'attribute queries answered from a tag read whole': aroundCompletionCases,
}
