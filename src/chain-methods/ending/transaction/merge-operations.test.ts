import { describe, it, expect } from 'vitest'

import { TEST_DIALECTE_CONFIG, createTestRecord } from '@/helpers'

import { mergeOperations } from './merge-operations'

import type { Operation } from '@/types'

type TestConfig = typeof TEST_DIALECTE_CONFIG
type TestOperation = Operation<TestConfig>

describe('mergeOperations', () => {
	type MergeResult = ReturnType<typeof mergeOperations<TestConfig>>

	const testCases: Array<{
		description: string
		input: TestOperation[]
		expected: {
			creates: number
			updates: number
			deletes: number
		}
		// Optional: specific assertions on records
		assertions?: (result: MergeResult) => void
	}> = [
		{
			description: 'no operations',
			input: [],
			expected: { creates: 0, updates: 0, deletes: 0 },
		},
		{
			description: 'single create',
			input: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A' } }),
				},
			],
			expected: { creates: 1, updates: 0, deletes: 0 },
		},
		{
			description: 'created + updated → created with final state',
			input: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v2' } }),
				},
			],
			expected: { creates: 1, updates: 0, deletes: 0 },
			assertions: (result) => {
				expect(result.creates[0].newRecord.value).toBe('v2')
			},
		},
		{
			description: 'created + deleted → no-op',
			input: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A' } }),
				},
				{
					status: 'deleted',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A' } }),
					newRecord: undefined,
				},
			],
			expected: { creates: 0, updates: 0, deletes: 0 },
		},
		{
			description: 'updated + updated → updated with final state',
			input: [
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v0' } }),
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v2' } }),
				},
			],
			expected: { creates: 0, updates: 1, deletes: 0 },
			assertions: (result) => {
				expect(result.updates[0].oldRecord.value).toBe('v0') // original oldRecord
				expect(result.updates[0].newRecord.value).toBe('v2') // final newRecord
			},
		},
		{
			description: 'updated + deleted → deleted with original oldRecord',
			input: [
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v0' } }),
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
				},
				{
					status: 'deleted',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
					newRecord: undefined,
				},
			],
			expected: { creates: 0, updates: 0, deletes: 1 },
			assertions: (result) => {
				expect(result.deletes[0].oldRecord.value).toBe('v0') // original oldRecord, not v1
			},
		},
		{
			description: 'deleted is terminal - no further merging',
			input: [
				{
					status: 'deleted',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A' } }),
					newRecord: undefined,
				},
			],
			expected: { creates: 0, updates: 0, deletes: 1 },
		},
		{
			description: 'multiple elements independently',
			input: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A' } }),
				},
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: '2', tagName: 'B' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '3', tagName: 'C', value: 'v1' } }),
					newRecord: createTestRecord({ record: { id: '3', tagName: 'C', value: 'v2' } }),
				},
			],
			expected: { creates: 2, updates: 1, deletes: 0 },
		},
		{
			description: 'complex scenario with multiple merges',
			input: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A' } }),
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '2', tagName: 'B', value: 'v0' } }),
					newRecord: createTestRecord({ record: { id: '2', tagName: 'B', value: 'v1' } }),
				},
				{
					status: 'deleted',
					oldRecord: createTestRecord({ record: { id: '2', tagName: 'B', value: 'v1' } }),
					newRecord: undefined,
				},
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: '3', tagName: 'C' } }),
				},
				{
					status: 'deleted',
					oldRecord: createTestRecord({ record: { id: '3', tagName: 'C' } }),
					newRecord: undefined,
				},
			],
			expected: { creates: 1, updates: 0, deletes: 1 },
		},
		{
			description: 'multiple updates on same element',
			input: [
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v0' } }),
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v2' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v2' } }),
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v3' } }),
				},
			],
			expected: { creates: 0, updates: 1, deletes: 0 },
			assertions: (result) => {
				expect(result.updates[0].oldRecord.value).toBe('v0')
				expect(result.updates[0].newRecord.value).toBe('v3')
			},
		},
		{
			description: 'created + multiple updates → created with final state',
			input: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v0' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v0' } }),
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v1' } }),
					newRecord: createTestRecord({ record: { id: '1', tagName: 'A', value: 'v2' } }),
				},
			],
			expected: { creates: 1, updates: 0, deletes: 0 },
			assertions: (result) => {
				expect(result.creates[0].newRecord.value).toBe('v2')
			},
		},
	]

	testCases.forEach(({ description, input, expected, assertions }) => {
		it(description, () => {
			const result = mergeOperations(input)

			expect(result.creates).toHaveLength(expected.creates)
			expect(result.updates).toHaveLength(expected.updates)
			expect(result.deletes).toHaveLength(expected.deletes)

			if (assertions) {
				assertions(result)
			}
		})
	})
})
