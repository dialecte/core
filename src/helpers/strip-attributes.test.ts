import { stripAttributes } from './strip-attributes'

import { describe, expect, it } from 'vitest'

import { DIALECTE_NAMESPACES, runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'
import type { TestDialecteConfig } from '@/test'
import type { RawRecord, TrackedRecord, TreeRecord, ChildrenOf } from '@/types'

type TestConfig = TestDialecteConfig

const ns = DIALECTE_NAMESPACES.default

const baseRecord = {
	id: '1',
	tagName: 'A' as const,
	namespace: ns,
	value: '',
	parent: null,
	children: [],
} satisfies Partial<RawRecord<TestConfig, 'A'>>

// ── RawRecord ─────────────────────────────────────────────────────────────────

describe('stripAttributes — RawRecord', () => {
	type TestCase = BaseTestCase & {
		record: RawRecord<TestConfig, 'A'>
		names: string[]
		expectedAttributeNames: string[]
	}

	const testCases: Record<string, TestCase> = {
		'no names → all attrs preserved': {
			record: { ...baseRecord, attributes: [{ name: 'aA' as const, value: 'v' }] },
			names: [],
			expectedAttributeNames: ['aA'],
		},
		'matching name → attr removed': {
			record: { ...baseRecord, attributes: [{ name: 'aA' as const, value: 'v' }] },
			names: ['aA'],
			expectedAttributeNames: [],
		},
		'non-matching name → attr preserved': {
			record: { ...baseRecord, attributes: [{ name: 'aA' as const, value: 'v' }] },
			names: ['other'],
			expectedAttributeNames: ['aA'],
		},
		'multiple names → only matching removed': {
			record: {
				...baseRecord,
				attributes: [
					{ name: 'aA' as const, value: 'v1' },
					{ name: 'aA' as const, value: 'v2' },
				],
			},
			names: ['aA'],
			expectedAttributeNames: [],
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		const result = stripAttributes(testCase.record, testCase.names)
		expect(result.attributes.map((a) => a.name)).toEqual(testCase.expectedAttributeNames)
	})
})

// ── TrackedRecord ─────────────────────────────────────────────────────────────

describe('stripAttributes — TrackedRecord', () => {
	type TestCase = BaseTestCase & {
		record: TrackedRecord<TestConfig, 'A'>
		names: string[]
		expectedAttributeNames: string[]
	}

	const testCases: Record<string, TestCase> = {
		'preserves status field': {
			record: {
				...baseRecord,
				attributes: [{ name: 'aA' as const, value: 'v' }],
				status: 'updated',
			},
			names: [],
			expectedAttributeNames: ['aA'],
		},
		'strips attr and preserves status': {
			record: {
				...baseRecord,
				attributes: [{ name: 'aA' as const, value: 'v' }],
				status: 'created',
			},
			names: ['aA'],
			expectedAttributeNames: [],
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		const result = stripAttributes(testCase.record, testCase.names)
		expect(result.attributes.map((a) => a.name)).toEqual(testCase.expectedAttributeNames)
		expect((result as TrackedRecord<TestConfig, 'A'>).status).toBe(testCase.record.status)
	})
})

// ── TreeRecord ────────────────────────────────────────────────────────────────

describe('stripAttributes — TreeRecord', () => {
	type TestCase = BaseTestCase & {
		record: TreeRecord<TestConfig, 'A'>
		names: string[]
		expectedRootAttrNames: string[]
		expectedChildAttrNames: string[]
	}

	const child: TreeRecord<TestConfig, 'AA_1'> = {
		...baseRecord,
		id: '2',
		tagName: 'AA_1',
		attributes: [{ name: 'aAA_1' as const, value: 'child-v' }],
		status: 'unchanged',
		tree: [],
	}

	const root: TreeRecord<TestConfig, 'A'> = {
		...baseRecord,
		attributes: [{ name: 'aA' as const, value: 'root-v' }],
		status: 'unchanged',
		tree: [child as unknown as TreeRecord<TestConfig, ChildrenOf<TestConfig, 'A'>>],
	}

	const testCases: Record<string, TestCase> = {
		'strips attr on root and all tree children recursively': {
			record: root,
			names: ['aA', 'aAA_1'],
			expectedRootAttrNames: [],
			expectedChildAttrNames: [],
		},
		'preserves non-matching attr on root and children': {
			record: root,
			names: ['other'],
			expectedRootAttrNames: ['aA'],
			expectedChildAttrNames: ['aAA_1'],
		},
		'preserves tree structure (children count unchanged)': {
			record: root,
			names: ['aA'],
			expectedRootAttrNames: [],
			expectedChildAttrNames: ['aAA_1'],
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		const result = stripAttributes(testCase.record, testCase.names)
		expect(result.attributes.map((a) => a.name)).toEqual(testCase.expectedRootAttrNames)
		expect(result.tree).toHaveLength(testCase.record.tree.length)
		expect(result.tree[0]?.attributes.map((a) => a.name) ?? []).toEqual(
			testCase.expectedChildAttrNames,
		)
	})
})

// ── Immutability ──────────────────────────────────────────────────────────────

describe('stripAttributes — immutability', () => {
	it('RawRecord: original attributes array not mutated', () => {
		const record: RawRecord<TestConfig, 'A'> = {
			...baseRecord,
			attributes: [{ name: 'aA', value: 'v' }],
		}
		stripAttributes(record, ['aA'])
		expect(record.attributes).toHaveLength(1)
	})

	it('TreeRecord: original root and children not mutated', () => {
		const childTree: TreeRecord<TestConfig, 'AA_1'> = {
			...baseRecord,
			id: '2',
			tagName: 'AA_1',
			attributes: [{ name: 'aAA_1' as const, value: 'v' }],
			status: 'unchanged',
			tree: [],
		}
		const rootTree: TreeRecord<TestConfig, 'A'> = {
			...baseRecord,
			attributes: [{ name: 'aA' as const, value: 'v' }],
			status: 'unchanged',
			tree: [childTree as unknown as TreeRecord<TestConfig, ChildrenOf<TestConfig, 'A'>>],
		}
		stripAttributes(rootTree, ['aA'])
		expect(rootTree.attributes).toHaveLength(1)
		expect(rootTree.tree[0]?.attributes).toHaveLength(1)
	})
})
