import { getLatestStagedRecord } from './staged-lookup'

import { describe, expect, it } from 'vitest'

import { createTestRecord } from '@/test'

import type { TestDialecteConfig } from '@/test'
import type { ElementsOf, Operation, RawRecord } from '@/types'

type TestRecord = RawRecord<TestDialecteConfig, ElementsOf<TestDialecteConfig>>

function raw(tagName: ElementsOf<TestDialecteConfig>, id: string): TestRecord {
	return createTestRecord({ record: { tagName: tagName as 'A', id } })
}
function created(record: TestRecord): Operation<TestDialecteConfig> {
	return { status: 'created', oldRecord: undefined, newRecord: record }
}
function updated(oldRecord: TestRecord, newRecord: TestRecord): Operation<TestDialecteConfig> {
	return { status: 'updated', oldRecord, newRecord }
}
function deleted(record: TestRecord): Operation<TestDialecteConfig> {
	return { status: 'deleted', oldRecord: record, newRecord: undefined }
}

/**
 * The by-id staged lookup must resolve from a maintained index, not a reverse scan of the whole
 * operations log — the scan is O(ops) per read and turns deepClone/bulk-create into O(N^2).
 * These pass an EMPTY log so only the index can answer.
 */
describe('getLatestStagedRecord — byId index', () => {
	it('resolves a created record by id from the index (no array scan)', () => {
		const a = raw('A', 'a1')
		const byId = new Map<string, Operation<TestDialecteConfig>>([['a1', created(a)]])

		const result = getLatestStagedRecord({
			stagedOperations: { log: [], byId },
			tagName: 'A',
			id: 'a1',
		})

		expect(result).toMatchObject({ id: 'a1', status: 'created' })
	})

	it('reflects the latest op via the index (updated)', () => {
		const a = raw('A', 'a1')
		const aNext = { ...raw('A', 'a1'), value: 'changed' }
		const byId = new Map<string, Operation<TestDialecteConfig>>([['a1', updated(a, aNext)]])

		const result = getLatestStagedRecord({
			stagedOperations: { log: [], byId },
			tagName: 'A',
			id: 'a1',
		})

		expect(result).toMatchObject({ id: 'a1', status: 'updated', value: 'changed' })
	})

	it('returns a deleted tombstone via the index', () => {
		const a = raw('A', 'a1')
		const byId = new Map<string, Operation<TestDialecteConfig>>([['a1', deleted(a)]])

		const result = getLatestStagedRecord({
			stagedOperations: { log: [], byId },
			tagName: 'A',
			id: 'a1',
		})

		expect(result).toMatchObject({ id: 'a1', status: 'deleted' })
	})

	it('throws when the indexed record has a different tagName', () => {
		const a = raw('A', 'a1')
		const byId = new Map<string, Operation<TestDialecteConfig>>([['a1', created(a)]])

		expect(() =>
			getLatestStagedRecord({
				stagedOperations: { log: [], byId },
				tagName: 'B' as ElementsOf<TestDialecteConfig>,
				id: 'a1',
			}),
		).toThrow()
	})

	it('returns undefined when the id is absent from the index', () => {
		const byId = new Map<string, Operation<TestDialecteConfig>>()

		const result = getLatestStagedRecord({
			stagedOperations: { log: [], byId },
			tagName: 'A',
			id: 'missing',
		})

		expect(result).toBeUndefined()
	})
})
