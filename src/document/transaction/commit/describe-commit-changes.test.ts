import { describeCommitChanges, describeHistoryStep } from './describe-commit-changes'

import { describe, expect, it } from 'vitest'

import { COMMIT_CHANGES_MAX } from '@/project/project.constants'

import type {
	CommitChanges,
	CommitWrites,
	HistoryImages,
	HistoryStepDirection,
	PlacedRecord,
	UnknownCommitChanges,
} from '@/project/types'

function placed(params: { id: string; tagName: string; parentId: string | null }): PlacedRecord {
	const { id, tagName, parentId } = params
	return { id, tagName, parent: parentId === null ? null : { id: parentId } }
}

function manyCreates(params: { count: number }): PlacedRecord[] {
	return Array.from({ length: params.count }, function created(_, index) {
		return placed({ id: `c${index}`, tagName: 'AA_1', parentId: 'a' })
	})
}

describe('describeCommitChanges', () => {
	const cases: Record<
		string,
		{ writes: CommitWrites; expected: CommitChanges | UnknownCommitChanges }
	> = {
		'creates, updates and deletes -> the exact refs, each with its tag and parent (after the write for updated, before for deleted), in the order given':
			{
				writes: {
					creates: [
						placed({ id: 'c2', tagName: 'AA_2', parentId: 'a' }),
						placed({ id: 'c1', tagName: 'AAA_1', parentId: 'c2' }),
					],
					updates: [
						placed({ id: 'a', tagName: 'A', parentId: 'root' }),
						placed({ id: 'root', tagName: 'Root', parentId: null }),
					],
					deletes: [{ id: 'd1', tagName: 'AA_1', parentId: 'a' }],
				},
				expected: {
					created: [
						{ id: 'c2', tagName: 'AA_2', parentId: 'a' },
						{ id: 'c1', tagName: 'AAA_1', parentId: 'c2' },
					],
					updated: [
						{ id: 'a', tagName: 'A', parentId: 'root' },
						{ id: 'root', tagName: 'Root', parentId: null },
					],
					deleted: [{ id: 'd1', tagName: 'AA_1', parentId: 'a' }],
				},
			},
		'a move between parents -> the moved record and both parents in updated': {
			writes: {
				creates: [],
				updates: [
					placed({ id: 'old', tagName: 'A', parentId: 'root' }),
					placed({ id: 'new', tagName: 'A', parentId: 'root' }),
					placed({ id: 'moved', tagName: 'AA_1', parentId: 'new' }),
				],
				deletes: [],
			},
			expected: {
				created: [],
				updated: [
					{ id: 'old', tagName: 'A', parentId: 'root' },
					{ id: 'new', tagName: 'A', parentId: 'root' },
					{ id: 'moved', tagName: 'AA_1', parentId: 'new' },
				],
				deleted: [],
			},
		},
		'more refs than the cap, exactly the cap -> { unknown: true } past it, the refs at it': {
			writes: {
				creates: manyCreates({ count: COMMIT_CHANGES_MAX }),
				updates: [placed({ id: 'a', tagName: 'A', parentId: 'root' })],
				deletes: [],
			},
			expected: { unknown: true },
		},
	}

	for (const [name, { writes, expected }] of Object.entries(cases)) {
		it(name, () => {
			expect(describeCommitChanges(writes)).toEqual(expected)
		})
	}

	it('exactly the cap -> the refs, none dropped', () => {
		const creates = manyCreates({ count: COMMIT_CHANGES_MAX })
		const changes = describeCommitChanges({ creates, updates: [], deletes: [] })
		expect(changes).toEqual({
			created: creates.map(function refOf(record) {
				return { id: record.id, tagName: record.tagName, parentId: 'a' }
			}),
			updated: [],
			deleted: [],
		})
	})

	it('a record holding more than its place -> only its id, tag and parent id in the ref', () => {
		const record = {
			...placed({ id: 'a', tagName: 'A', parentId: 'root' }),
			value: 'v',
			children: [],
		}
		const changes = describeCommitChanges({ creates: [], updates: [record], deletes: [] })
		expect(changes).toStrictEqual({
			created: [],
			updated: [{ id: 'a', tagName: 'A', parentId: 'root' }],
			deleted: [],
		})
	})
})

/** One commit's images: c1 created under a, a updated (moved from root to b), d1 deleted from a. */
const IMAGES: HistoryImages = {
	creates: [placed({ id: 'c1', tagName: 'AA_1', parentId: 'a' })],
	befores: [placed({ id: 'a', tagName: 'A', parentId: 'root' })],
	afters: [placed({ id: 'a', tagName: 'A', parentId: 'b' })],
	deletes: [placed({ id: 'd1', tagName: 'AA_2', parentId: 'a' })],
}

describe('describeHistoryStep', () => {
	const cases: Record<
		string,
		{
			images: HistoryImages
			direction: HistoryStepDirection
			expected: CommitChanges | UnknownCommitChanges
		}
	> = {
		'forward (a redo) -> the commit: created as created, updated after the write, deleted with the parent it had':
			{
				images: IMAGES,
				direction: 'forward',
				expected: {
					created: [{ id: 'c1', tagName: 'AA_1', parentId: 'a' }],
					updated: [{ id: 'a', tagName: 'A', parentId: 'b' }],
					deleted: [{ id: 'd1', tagName: 'AA_2', parentId: 'a' }],
				},
			},
		'back (an undo) -> the inverse: the deleted created again, the updated with their parent before, the created deleted':
			{
				images: IMAGES,
				direction: 'back',
				expected: {
					created: [{ id: 'd1', tagName: 'AA_2', parentId: 'a' }],
					updated: [{ id: 'a', tagName: 'A', parentId: 'root' }],
					deleted: [{ id: 'c1', tagName: 'AA_1', parentId: 'a' }],
				},
			},
		'back past the cap -> { unknown: true }': {
			images: {
				creates: manyCreates({ count: COMMIT_CHANGES_MAX + 1 }),
				befores: [],
				afters: [],
				deletes: [],
			},
			direction: 'back',
			expected: { unknown: true },
		},
		'forward at exactly the cap -> the refs': {
			images: {
				creates: [],
				befores: [],
				afters: [],
				deletes: manyCreates({ count: COMMIT_CHANGES_MAX }),
			},
			direction: 'forward',
			expected: {
				created: [],
				updated: [],
				deleted: manyCreates({ count: COMMIT_CHANGES_MAX }).map(function refOf(record) {
					return { id: record.id, tagName: record.tagName, parentId: 'a' }
				}),
			},
		},
	}

	for (const [name, { images, direction, expected }] of Object.entries(cases)) {
		it(name, () => {
			expect(describeHistoryStep({ images, direction })).toEqual(expected)
		})
	}
})
