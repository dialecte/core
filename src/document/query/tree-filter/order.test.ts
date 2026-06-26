import { applyOrder } from './order'

import { describe, expect } from 'vitest'

import { createTestRecord, runTestCases, TEST_DIALECTE_CONFIG } from '@/test'

import type { BaseTestCase, TestDialecteConfig, TestRecord } from '@/test'
import type { AnyTreeRecord, ElementsOf, TreeRecord } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Tree = TreeRecord<TestDialecteConfig, ElementsOf<TestDialecteConfig>>

function node(record: TestRecord<TestDialecteConfig>, tree: Tree[] = []): Tree {
	return { ...createTestRecord({ type: 'tree', record }), tree }
}

type Shape = { tagName: string; tree: Shape[] }

function toShape(record: AnyTreeRecord): Shape {
	return {
		tagName: record.tagName,
		tree: record.tree.map((child) => toShape(child as AnyTreeRecord)),
	}
}

// ── Tests ────────────────────────────────────────────────────────────────────
//
// TEST_DIALECTE_CONFIG.children: Root → [A, B, C]; A → [AA_1, AA_2, AA_3]; …

describe('applyOrder', () => {
	type TestCase = BaseTestCase & {
		tree: Tree
		expected: Shape
	}

	const testCases: Record<string, TestCase> = {
		'orders children by the config sequence': {
			tree: node({ tagName: 'Root', id: 'r' }, [
				node({ tagName: 'C', id: 'c' }),
				node({ tagName: 'A', id: 'a' }),
				node({ tagName: 'B', id: 'b' }),
			]),
			expected: {
				tagName: 'Root',
				tree: [
					{ tagName: 'A', tree: [] },
					{ tagName: 'B', tree: [] },
					{ tagName: 'C', tree: [] },
				],
			},
		},
		'orders nested children too': {
			tree: node({ tagName: 'A', id: 'a' }, [
				node({ tagName: 'AA_2', id: 'aa2' }),
				node({ tagName: 'AA_1', id: 'aa1' }, [
					node({ tagName: 'AAA_2', id: 'aaa2' }),
					node({ tagName: 'AAA_1', id: 'aaa1' }),
				]),
			]),
			expected: {
				tagName: 'A',
				tree: [
					{
						tagName: 'AA_1',
						tree: [
							{ tagName: 'AAA_1', tree: [] },
							{ tagName: 'AAA_2', tree: [] },
						],
					},
					{ tagName: 'AA_2', tree: [] },
				],
			},
		},
		'leaf is unchanged': {
			tree: node({ tagName: 'A', id: 'a' }),
			expected: { tagName: 'A', tree: [] },
		},
	}

	runTestCases.generic(testCases, (tc) => {
		const result = applyOrder({ tree: tc.tree, childrenConfig: TEST_DIALECTE_CONFIG.children })
		expect(toShape(result)).toEqual(tc.expected)
	})
})
