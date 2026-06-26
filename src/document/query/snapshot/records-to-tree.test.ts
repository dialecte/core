import { recordsToTree } from './records-to-tree'

import { describe, expect, it } from 'vitest'

import { createTestRecord } from '@/test'

import type { AnyTrackedRecord, AnyTreeRecord } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function tracked(
	tagName: string,
	id: string,
	opts: {
		parentId?: string
		children?: { id: string; tagName: string }[]
		status?: AnyTrackedRecord['status']
		value?: string
	} = {},
): AnyTrackedRecord {
	const base = createTestRecord({
		type: 'tracked',
		record: { tagName: tagName as 'A', id },
	}) as AnyTrackedRecord
	return {
		...base,
		status: opts.status ?? 'unchanged',
		value: opts.value ?? base.value,
		parent: opts.parentId ? { tagName: 'Root', id: opts.parentId } : base.parent,
		children: (opts.children ?? []) as AnyTrackedRecord['children'],
	}
}

type Shape = { tagName: string; status: string; tree: Shape[] }

function toShape(record: AnyTreeRecord): Shape {
	return {
		tagName: record.tagName,
		status: record.status,
		tree: record.tree.map((child) => toShape(child as AnyTreeRecord)),
	}
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('recordsToTree', () => {
	it('builds a single-node tree for a childless root', () => {
		const root = tracked('Root', 'root-1')

		const tree = recordsToTree({ liveRecords: [root], deletedRecords: [], rootId: 'root-1' })

		expect(toShape(tree)).toEqual({ tagName: 'Root', status: 'unchanged', tree: [] })
	})

	it('nests children in the order of each record children array', () => {
		const root = tracked('Root', 'root-1', {
			children: [
				{ id: 'a-1', tagName: 'A' },
				{ id: 'b-1', tagName: 'B' },
			],
		})
		const a = tracked('A', 'a-1', { parentId: 'root-1' })
		const b = tracked('B', 'b-1', { parentId: 'root-1' })

		const tree = recordsToTree({
			liveRecords: [root, a, b],
			deletedRecords: [],
			rootId: 'root-1',
		})

		expect(toShape(tree)).toEqual({
			tagName: 'Root',
			status: 'unchanged',
			tree: [
				{ tagName: 'A', status: 'unchanged', tree: [] },
				{ tagName: 'B', status: 'unchanged', tree: [] },
			],
		})
	})

	it('builds nested subtrees recursively', () => {
		const root = tracked('Root', 'root-1', { children: [{ id: 'a-1', tagName: 'A' }] })
		const a = tracked('A', 'a-1', {
			parentId: 'root-1',
			children: [{ id: 'aa-1', tagName: 'AA_1' }],
		})
		const aa = tracked('AA_1', 'aa-1', { parentId: 'a-1' })

		const tree = recordsToTree({
			liveRecords: [root, a, aa],
			deletedRecords: [],
			rootId: 'root-1',
		})

		expect(toShape(tree)).toEqual({
			tagName: 'Root',
			status: 'unchanged',
			tree: [
				{
					tagName: 'A',
					status: 'unchanged',
					tree: [{ tagName: 'AA_1', status: 'unchanged', tree: [] }],
				},
			],
		})
	})

	it('skips child refs that are not present in the live set (orphan-safe)', () => {
		const root = tracked('Root', 'root-1', {
			children: [
				{ id: 'a-1', tagName: 'A' },
				{ id: 'missing', tagName: 'B' },
			],
		})
		const a = tracked('A', 'a-1', { parentId: 'root-1' })

		const tree = recordsToTree({
			liveRecords: [root, a],
			deletedRecords: [],
			rootId: 'root-1',
		})

		expect(toShape(tree)).toEqual({
			tagName: 'Root',
			status: 'unchanged',
			tree: [{ tagName: 'A', status: 'unchanged', tree: [] }],
		})
	})

	it('re-attaches deleted tombstones under their parent', () => {
		const root = tracked('Root', 'root-1', { children: [{ id: 'a-1', tagName: 'A' }] })
		const a = tracked('A', 'a-1', { parentId: 'root-1' })
		const deletedB = tracked('B', 'b-1', { parentId: 'root-1', status: 'deleted' })

		const tree = recordsToTree({
			liveRecords: [root, a],
			deletedRecords: [deletedB],
			rootId: 'root-1',
		})

		expect(toShape(tree)).toEqual({
			tagName: 'Root',
			status: 'unchanged',
			tree: [
				{ tagName: 'A', status: 'unchanged', tree: [] },
				{ tagName: 'B', status: 'deleted', tree: [] },
			],
		})
	})

	it('throws when the root id is not in the live set', () => {
		const a = tracked('A', 'a-1')

		expect(() =>
			recordsToTree({ liveRecords: [a], deletedRecords: [], rootId: 'missing' }),
		).toThrow()
	})
})
