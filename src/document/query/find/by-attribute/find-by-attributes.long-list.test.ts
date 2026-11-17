import { findByAttributes } from './find-by-attributes'

import { describe, expect } from 'vitest'

import { createStagedOperations } from '@/document'
import { createPerf } from '@/perf'
import { InMemoryStore } from '@/store'
import { makeDocument, makeRecord } from '@/store/contract/store-contract.fixtures'
import { TEST_DIALECTE_CONFIG, runTestCases } from '@/test'

import type { Context } from '@/document'
import type { Store } from '@/store'
import type { BaseTestCase, TestDialecteConfig } from '@/test'

describe('findByAttributes - a list of 5,000 values over 5,000 elements', () => {
	type TestCase = BaseTestCase & { lookup: 'the store' | 'none (tag read)' }

	const testCases: Record<string, TestCase> = {
		'answered by the store, then checked again → each value read a bounded number of times, every element found':
			{ lookup: 'the store' },
		'a store without the lookup (tag read, then filtered) → each value read a bounded number of times, every element found':
			{ lookup: 'none (tag read)' },
	}

	async function act(testCase: TestCase): Promise<void> {
		const ids = Array.from({ length: LONG_LIST_LENGTH }, (_, index) => `r${index}`)
		const store = new InMemoryStore(`long-list-${crypto.randomUUID()}`)
		await store.registerDocument(makeDocument())
		await store.bulkWrite('doc-1', {
			creates: ids.map((id) => makeRecord({ id, attributes: [{ name: 'aA', value: `v-${id}` }] })),
		})
		const counted = { reads: 0 }
		// every index read of the list counted: matching each element against the whole list reads it 12.5 M times
		const values = new Proxy(
			ids.map((id) => `v-${id}`),
			{
				get: function countRead(target, property, receiver) {
					if (typeof property === 'string' && /^\d+$/.test(property)) counted.reads += 1
					return Reflect.get(target, property, receiver)
				},
			},
		)
		const context = {
			store: testCase.lookup === 'the store' ? store : withoutAttributeLookup(store),
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: 'doc-1',
			stagedOperations: createStagedOperations<TestDialecteConfig>(),
			perf: createPerf({ enabled: false }),
		} as unknown as Context<TestDialecteConfig>
		const found = await findByAttributes({ context, tagName: 'A', attributes: { aA: values } })
		expect({ found: found.length, boundedReads: counted.reads <= 4 * LONG_LIST_LENGTH }).toEqual({
			found: LONG_LIST_LENGTH,
			boundedReads: true,
		})
	}

	runTestCases.generic(testCases, act)
})

/** The elements and the values of the long-list case. */
const LONG_LIST_LENGTH = 5_000

/** The store as it is, without `getByAttributes`: read by tag and filtered by the query layer. */
function withoutAttributeLookup(store: Store): Store {
	return new Proxy(store, {
		get: function memberOfStore(target, property) {
			if (property === 'getByAttributes') return undefined
			const member: unknown = Reflect.get(target, property, target)
			return typeof member === 'function' ? member.bind(target) : member
		},
	})
}
