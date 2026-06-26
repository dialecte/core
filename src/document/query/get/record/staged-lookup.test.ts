import {
	getLatestStagedRecord,
	overlayAllStaged,
	overlayStaged,
	indexStagedDeletesByParent,
} from './staged-lookup'

import { describe, expect, it } from 'vitest'

import { createTestRecord } from '@/test'

import type { TestDialecteConfig } from '@/test'
import type { ElementsOf, Operation, RawRecord } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Rec = RawRecord<TestDialecteConfig, ElementsOf<TestDialecteConfig>>

function raw<
	GenericConfig extends TestDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(tagName: GenericElement, id: string, parentId?: string): Rec {
	const record = createTestRecord({ record: { tagName, id } })
	if (parentId) {
		return { ...record, parent: { tagName: 'Root', id: parentId } }
	}
	return record
}

function created(record: Rec): Operation<TestDialecteConfig> {
	return { status: 'created', oldRecord: undefined, newRecord: record }
}

function updated(oldRecord: Rec, newRecord: Rec): Operation<TestDialecteConfig> {
	return { status: 'updated', oldRecord, newRecord }
}

function deleted(record: Rec): Operation<TestDialecteConfig> {
	return { status: 'deleted', oldRecord: record, newRecord: undefined }
}

// ── overlayAllStaged ──────────────────────────────────────────────────────────

describe('overlayAllStaged', () => {
	it('marks untouched DB records as unchanged', () => {
		const a = raw('A', 'a1')

		const { live, deleted: tombstones } = overlayAllStaged({
			rawRecords: [a],
			stagedOperations: [],
		})

		expect(live.get('a1')).toMatchObject({ id: 'a1', status: 'unchanged' })
		expect(tombstones).toEqual([])
	})

	it('adds created records with status "created"', () => {
		const a = raw('A', 'a1')
		const b = raw('B', 'b1')

		const { live } = overlayAllStaged({
			rawRecords: [a],
			stagedOperations: [created(b)],
		})

		expect(live.get('b1')).toMatchObject({ id: 'b1', status: 'created' })
		expect(live.size).toBe(2)
	})

	it('replaces updated records and marks them "updated"', () => {
		const a = raw('A', 'a1')
		const aNext = { ...raw('A', 'a1'), value: 'changed' }

		const { live } = overlayAllStaged({
			rawRecords: [a],
			stagedOperations: [updated(a, aNext)],
		})

		expect(live.get('a1')).toMatchObject({ id: 'a1', status: 'updated', value: 'changed' })
	})

	it('removes deleted records from live set', () => {
		const a = raw('A', 'a1')

		const { live, deleted: tombstones } = overlayAllStaged({
			rawRecords: [a],
			stagedOperations: [deleted(a)],
		})

		expect(live.has('a1')).toBe(false)
		expect(tombstones).toEqual([])
	})

	it('returns deleted records as tombstones when includeDeleted is set', () => {
		const a = raw('A', 'a1')

		const { live, deleted: tombstones } = overlayAllStaged({
			rawRecords: [a],
			stagedOperations: [deleted(a)],
			includeDeleted: true,
		})

		expect(live.has('a1')).toBe(false)
		expect(tombstones).toHaveLength(1)
		expect(tombstones[0]).toMatchObject({ id: 'a1', status: 'deleted' })
	})

	it('omits a tombstone for a record created and deleted in the same set', () => {
		const a = raw('A', 'a1')

		const { live, deleted: tombstones } = overlayAllStaged({
			rawRecords: [],
			stagedOperations: [created(a), deleted(a)],
			includeDeleted: true,
		})

		expect(live.has('a1')).toBe(false)
		expect(tombstones).toEqual([])
	})
})

// ── indexStagedDeletesByParent ──────────────────────────────────────────────

describe('indexStagedDeletesByParent', () => {
	it('groups staged deletes by their original parent id', () => {
		const child = raw('A', 'a1', 'root')

		const index = indexStagedDeletesByParent([deleted(child)])

		expect(index.get('root')).toHaveLength(1)
		expect(index.get('root')?.[0]).toMatchObject({ id: 'a1', status: 'deleted' })
	})

	it('groups multiple deletes under the same parent (insertion order)', () => {
		const a = raw('A', 'a1', 'root')
		const b = raw('B', 'b1', 'root')

		const index = indexStagedDeletesByParent([deleted(a), deleted(b)])

		expect(index.get('root')?.map((record) => record.id)).toEqual(['a1', 'b1'])
	})

	it('ignores created and updated operations', () => {
		const c = raw('A', 'a1', 'root')
		const u = raw('B', 'b1', 'root')

		const index = indexStagedDeletesByParent([created(c), updated(u, u)])

		expect(index.size).toBe(0)
	})

	it('excludes records created and deleted in the same staged set', () => {
		const child = raw('A', 'a1', 'root')

		const index = indexStagedDeletesByParent([created(child), deleted(child)])

		expect(index.size).toBe(0)
	})
})

// ── getLatestStagedRecord ─────────────────────────────────────────────────────

describe('getLatestStagedRecord', () => {
	it('returns a created record matched by id', () => {
		const result = getLatestStagedRecord({
			stagedOperations: [created(raw('A', 'a1'))],
			tagName: 'A',
			id: 'a1',
		})

		expect(result).toMatchObject({ id: 'a1', status: 'created' })
	})

	it('returns an updated record matched by id', () => {
		const result = getLatestStagedRecord({
			stagedOperations: [updated(raw('A', 'a1'), raw('A', 'a1'))],
			tagName: 'A',
			id: 'a1',
		})

		expect(result).toMatchObject({ id: 'a1', status: 'updated' })
	})

	it('returns a deleted record with status "deleted"', () => {
		const result = getLatestStagedRecord({
			stagedOperations: [deleted(raw('A', 'a1'))],
			tagName: 'A',
			id: 'a1',
		})

		expect(result).toMatchObject({ id: 'a1', status: 'deleted' })
	})

	it('returns undefined when the id is not staged', () => {
		const result = getLatestStagedRecord({
			stagedOperations: [created(raw('A', 'a1'))],
			tagName: 'A',
			id: 'other',
		})

		expect(result).toBeUndefined()
	})

	it('returns the most recent operation (scans in reverse)', () => {
		const result = getLatestStagedRecord({
			stagedOperations: [
				updated(raw('A', 'a1'), { ...raw('A', 'a1'), value: 'first' }),
				updated(raw('A', 'a1'), { ...raw('A', 'a1'), value: 'last' }),
			],
			tagName: 'A',
			id: 'a1',
		})

		expect(result).toMatchObject({ id: 'a1', value: 'last' })
	})

	it('throws when the staged tagName does not match the requested one', () => {
		expect(() =>
			getLatestStagedRecord({
				stagedOperations: [created(raw('A', 'a1'))],
				tagName: 'B',
				id: 'a1',
			}),
		).toThrow()
	})

	it('matches by tagName only for singletons (id omitted)', () => {
		const result = getLatestStagedRecord({
			stagedOperations: [created(raw('A', 'a1'))],
			tagName: 'A',
		})

		expect(result).toMatchObject({ id: 'a1', status: 'created' })
	})
})

// ── overlayStaged ─────────────────────────────────────────────────────────────

describe('overlayStaged', () => {
	it('marks untouched DB records as unchanged', () => {
		const result = overlayStaged({
			tagName: 'A',
			rawRecords: [raw('A', 'a1')],
			stagedOperations: [],
		})

		expect(result).toEqual([expect.objectContaining({ id: 'a1', status: 'unchanged' })])
	})

	it('adds a created record of the matching tagName', () => {
		const result = overlayStaged({
			tagName: 'A',
			rawRecords: [raw('A', 'a1')],
			stagedOperations: [created(raw('A', 'a2'))],
		})

		expect(result).toHaveLength(2)
		expect(result).toContainEqual(expect.objectContaining({ id: 'a2', status: 'created' }))
	})

	it('skips a created record of a different tagName', () => {
		const result = overlayStaged({
			tagName: 'A',
			rawRecords: [raw('A', 'a1')],
			stagedOperations: [created(raw('B', 'b1'))],
		})

		expect(result.map((record) => record.id)).toEqual(['a1'])
	})

	it('replaces an updated record', () => {
		const result = overlayStaged({
			tagName: 'A',
			rawRecords: [raw('A', 'a1')],
			stagedOperations: [updated(raw('A', 'a1'), { ...raw('A', 'a1'), value: 'changed' })],
		})

		expect(result).toEqual([
			expect.objectContaining({ id: 'a1', status: 'updated', value: 'changed' }),
		])
	})

	it('removes a deleted record of the matching tagName', () => {
		const result = overlayStaged({
			tagName: 'A',
			rawRecords: [raw('A', 'a1')],
			stagedOperations: [deleted(raw('A', 'a1'))],
		})

		expect(result).toEqual([])
	})

	it('ignores a deleted record of a different tagName', () => {
		const result = overlayStaged({
			tagName: 'A',
			rawRecords: [raw('A', 'a1')],
			stagedOperations: [deleted(raw('B', 'b1'))],
		})

		expect(result.map((record) => record.id)).toEqual(['a1'])
	})
})
