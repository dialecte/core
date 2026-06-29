import { applyUnwrap } from './unwrap'

import { describe, expect } from 'vitest'

import { createTestRecord, runTestCases } from '@/test'

import type { BaseTestCase, TestDialecteConfig, TestRecord } from '@/test'
import type { AnyTreeRecord, ElementsOf, TreeRecord } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Tree = TreeRecord<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
type El = ElementsOf<TestDialecteConfig>

function node(record: TestRecord<TestDialecteConfig>, tree: Tree[] = []): Tree {
	return { ...createTestRecord({ type: 'tree', record }), tree } as Tree
}

type Shape = { tagName: string; tree: Shape[] }

function toShape(record: AnyTreeRecord): Shape {
	return {
		tagName: record.tagName,
		tree: record.tree.map((child) => toShape(child as AnyTreeRecord)),
	}
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('applyUnwrap', () => {
	type TestCase = BaseTestCase & {
		tree: Tree
		unwrap: El[]
		expected: Shape
	}

	const testCases: Record<string, TestCase> = {
		'unwraps a layer and promotes its children': {
			tree: node({ tagName: 'A', id: 'a' }, [
				node({ tagName: 'AA_1', id: 'aa1' }, [node({ tagName: 'AAA_1', id: 'aaa1' })]),
				node({ tagName: 'AA_2', id: 'aa2' }),
			]),
			unwrap: ['AA_1'],
			expected: {
				tagName: 'A',
				tree: [
					{ tagName: 'AAA_1', tree: [] },
					{ tagName: 'AA_2', tree: [] },
				],
			},
		},
		'unwraps several tags': {
			tree: node({ tagName: 'A', id: 'a' }, [
				node({ tagName: 'AA_1', id: 'aa1' }, [node({ tagName: 'AAA_1', id: 'aaa1' })]),
				node({ tagName: 'AA_2', id: 'aa2' }),
			]),
			unwrap: ['AA_1', 'AA_2'],
			expected: { tagName: 'A', tree: [{ tagName: 'AAA_1', tree: [] }] },
		},
		'unwraps recursively through nested targets': {
			tree: node({ tagName: 'A', id: 'a' }, [
				node({ tagName: 'AA_1', id: 'aa1' }, [
					node({ tagName: 'AAA_1', id: 'aaa1' }, [node({ tagName: 'AAAA_1', id: 'aaaa1' })]),
				]),
			]),
			unwrap: ['AA_1', 'AAA_1'],
			expected: { tagName: 'A', tree: [{ tagName: 'AAAA_1', tree: [] }] },
		},
		'tag not present is a no-op': {
			tree: node({ tagName: 'A', id: 'a' }, [node({ tagName: 'AA_1', id: 'aa1' })]),
			unwrap: ['AA_3'],
			expected: { tagName: 'A', tree: [{ tagName: 'AA_1', tree: [] }] },
		},
		'leaf tree is unchanged': {
			tree: node({ tagName: 'A', id: 'a' }),
			unwrap: ['AA_1'],
			expected: { tagName: 'A', tree: [] },
		},
		'never unwraps the root itself': {
			tree: node({ tagName: 'A', id: 'a' }, [node({ tagName: 'AA_1', id: 'aa1' })]),
			unwrap: ['A'],
			expected: { tagName: 'A', tree: [{ tagName: 'AA_1', tree: [] }] },
		},
	}

	runTestCases.generic(testCases, (tc) => {
		const result = applyUnwrap({ tree: tc.tree, unwrapTagNames: tc.unwrap })
		expect(toShape(result)).toEqual(tc.expected)
	})
})
