import { applyOmit, parseOmit } from './omit'

import { describe, expect } from 'vitest'

import { createTestRecord, runTestCases } from '@/test'

import type { OmitEntry } from './types'
import type { BaseTestCase, TestDialecteConfig, TestRecord } from '@/test'
import type { AnyTreeRecord, ElementsOf, TreeRecord } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Tree = TreeRecord<TestDialecteConfig, ElementsOf<TestDialecteConfig>>

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

// A root with two children, the first carrying an attribute for `where` matching.
function rootWith2(): Tree {
	return node({ tagName: 'A', id: 'a' }, [
		node({ tagName: 'AA_1', id: 'aa1', attributes: { aAA_1: 'x' } }, [
			node({ tagName: 'AAA_1', id: 'aaa1', attributes: { aAAA_1: 'y' } }),
		]),
		node({ tagName: 'AA_2', id: 'aa2', attributes: { aAA_2: 'z' } }),
	])
}

// ── parseOmit ────────────────────────────────────────────────────────────────

describe('parseOmit', () => {
	type TestCase = BaseTestCase & {
		omit: OmitEntry<TestDialecteConfig>[] | undefined
		expectedUnconditional: string[]
		expectedConditional: { tagName: string; where: Record<string, unknown>; scope: string }[]
	}

	const testCases: Record<string, TestCase> = {
		'undefined → empty spec': {
			omit: undefined,
			expectedUnconditional: [],
			expectedConditional: [],
		},
		'string entry → unconditional': {
			omit: ['AA_1'],
			expectedUnconditional: ['AA_1'],
			expectedConditional: [],
		},
		'object without where → unconditional': {
			omit: [{ AA_1: {} }],
			expectedUnconditional: ['AA_1'],
			expectedConditional: [],
		},
		'object with where → conditional self (default scope)': {
			omit: [{ AA_1: { where: { aAA_1: 'x' } } }],
			expectedUnconditional: [],
			expectedConditional: [{ tagName: 'AA_1', where: { aAA_1: 'x' }, scope: 'self' }],
		},
		'object with where + scope children → conditional children': {
			omit: [{ AA_1: { where: { aAA_1: 'x' }, scope: 'children' } }],
			expectedUnconditional: [],
			expectedConditional: [{ tagName: 'AA_1', where: { aAA_1: 'x' }, scope: 'children' }],
		},
	}

	runTestCases.generic(testCases, (tc) => {
		const result = parseOmit(tc.omit)
		expect([...result.unconditional]).toEqual(tc.expectedUnconditional)
		expect(result.conditional).toEqual(tc.expectedConditional)
	})
})

// ── applyOmit ────────────────────────────────────────────────────────────────

describe('applyOmit', () => {
	type TestCase = BaseTestCase & {
		omit: OmitEntry<TestDialecteConfig>[]
		expected: Shape
	}

	const full: Shape = {
		tagName: 'A',
		tree: [
			{ tagName: 'AA_1', tree: [{ tagName: 'AAA_1', tree: [] }] },
			{ tagName: 'AA_2', tree: [] },
		],
	}

	const testCases: Record<string, TestCase> = {
		'empty omit → unchanged': {
			omit: [],
			expected: full,
		},
		'unconditional string drops the node': {
			omit: ['AA_1'],
			expected: { tagName: 'A', tree: [{ tagName: 'AA_2', tree: [] }] },
		},
		'unconditional object (no where) drops the node': {
			omit: [{ AA_1: {} }],
			expected: { tagName: 'A', tree: [{ tagName: 'AA_2', tree: [] }] },
		},
		'conditional where match drops the node': {
			omit: [{ AA_1: { where: { aAA_1: 'x' } } }],
			expected: { tagName: 'A', tree: [{ tagName: 'AA_2', tree: [] }] },
		},
		'conditional where mismatch keeps the node': {
			omit: [{ AA_1: { where: { aAA_1: 'other' } } }],
			expected: full,
		},
		'scope children keeps the node but drops its descendants': {
			omit: [{ AA_1: { where: { aAA_1: 'x' }, scope: 'children' } }],
			expected: {
				tagName: 'A',
				tree: [
					{ tagName: 'AA_1', tree: [] },
					{ tagName: 'AA_2', tree: [] },
				],
			},
		},
		'never drops the root itself': {
			omit: ['A'],
			expected: full,
		},
	}

	runTestCases.generic(testCases, (tc) => {
		const result = applyOmit({ tree: rootWith2(), omit: tc.omit })
		expect(toShape(result)).toEqual(tc.expected)
	})
})
