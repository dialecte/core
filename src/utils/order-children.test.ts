import { orderByConfigSequence } from './order-children'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Node = { tagName: string; id: string }

function nodes(...specs: [string, string][]): Node[] {
	return specs.map(([tagName, id]) => ({ tagName, id }))
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('orderByConfigSequence', () => {
	type TestCase = BaseTestCase & {
		parentTagName: string
		children: Node[]
		childrenConfig: Record<string, readonly string[]>
		expected: string[] // resulting ids, in order
	}

	const testCases: Record<string, TestCase> = {
		'reorders children to the declared sequence': {
			parentTagName: 'Root',
			children: nodes(['C', 'c'], ['A', 'a'], ['B', 'b']),
			childrenConfig: { Root: ['A', 'B', 'C'] },
			expected: ['a', 'b', 'c'],
		},
		'keeps relative order within the same tagName': {
			parentTagName: 'Root',
			children: nodes(['A', 'a2'], ['A', 'a1'], ['B', 'b']),
			childrenConfig: { Root: ['A', 'B'] },
			expected: ['a2', 'a1', 'b'],
		},
		'appends unknown tags last, preserving their order': {
			parentTagName: 'Root',
			children: nodes(['X', 'x'], ['A', 'a'], ['Y', 'y']),
			childrenConfig: { Root: ['A', 'B'] },
			expected: ['a', 'x', 'y'],
		},
		'already-ordered input is unchanged': {
			parentTagName: 'Root',
			children: nodes(['A', 'a'], ['B', 'b']),
			childrenConfig: { Root: ['A', 'B'] },
			expected: ['a', 'b'],
		},
		'parent with no declared sequence returns input order': {
			parentTagName: 'Root',
			children: nodes(['C', 'c'], ['A', 'a']),
			childrenConfig: {},
			expected: ['c', 'a'],
		},
		'empty children → empty result': {
			parentTagName: 'Root',
			children: [],
			childrenConfig: { Root: ['A', 'B'] },
			expected: [],
		},
	}

	runTestCases.generic(testCases, (tc) => {
		const result = orderByConfigSequence({
			parentTagName: tc.parentTagName,
			children: tc.children,
			childrenConfig: tc.childrenConfig,
		})
		expect(result.map((node) => node.id)).toEqual(tc.expected)
	})
})
