import { toTrackedRecord, toRawRecord, toTreeRecord, toFullAttributeArray } from './converter'
import { isRawRecord, isTrackedRecord, isTreeRecord } from './guard'

import { describe, expect } from 'vitest'

import { TEST_DIALECTE_CONFIG, DIALECTE_NAMESPACES, runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'
import type {
	RawRecord,
	TrackedRecord,
	TreeRecord,
	ElementsOf,
	FullAttributeObjectOf,
	AttributesValueObjectOf,
} from '@/types'

describe('Record Converter', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	describe('toRawRecord', () => {
		type TestCase = BaseTestCase & {
			input:
				| RawRecord<TestConfig, TestElement>
				| TrackedRecord<TestConfig, TestElement>
				| TreeRecord<TestConfig, TestElement>
			expectedKeys: number
		}

		const testCases: Record<string, TestCase> = {
			'converts ChainRecord to RawRecord by stripping status': {
				input: {
					id: '1',
					tagName: 'A',
					namespace: DIALECTE_NAMESPACES.default,
					attributes: [],
					children: [],
					parent: null,
					value: '',
					status: 'updated',
				},
				expectedKeys: 7,
			},
			'converts TreeRecord to RawRecord by stripping status and tree': {
				input: {
					id: '2',
					tagName: 'A',
					namespace: DIALECTE_NAMESPACES.default,
					attributes: [],
					children: [],
					parent: null,
					value: '',
					status: 'created',
					tree: [],
				},
				expectedKeys: 7,
			},
			'returns RawRecord unchanged': {
				input: {
					id: '3',
					tagName: 'A',
					namespace: DIALECTE_NAMESPACES.default,
					attributes: [],
					children: [],
					parent: null,
					value: '',
				},
				expectedKeys: 7,
			},
		}

		function act({ input, expectedKeys }: TestCase) {
			const result = toRawRecord(input)
			expect(Object.keys(result)).toHaveLength(expectedKeys)
			expect(isRawRecord(result)).toBe(true)
			expect('status' in result).toBe(false)
			expect('tree' in result).toBe(false)
		}

		runTestCases.generic(testCases, act)
	})

	describe('toChainRecord', () => {
		type TestCase = BaseTestCase & {
			input: {
				record:
					| RawRecord<TestConfig, 'A'>
					| TrackedRecord<TestConfig, 'A'>
					| TreeRecord<TestConfig, 'A'>
				status?: 'unchanged' | 'created' | 'updated'
			}
			expectedStatus: 'unchanged' | 'created' | 'updated'
		}

		const rawRecord: RawRecord<TestConfig, 'A'> = {
			id: '1',
			tagName: 'A',
			namespace: DIALECTE_NAMESPACES.default,
			attributes: [],
			children: [],
			parent: null,
			value: '',
		}

		const testCases: Record<string, TestCase> = {
			'converts RawRecord to ChainRecord with default status=unchanged': {
				input: { record: rawRecord },
				expectedStatus: 'unchanged',
			},
			'converts RawRecord to ChainRecord with custom status': {
				input: { record: rawRecord, status: 'created' },
				expectedStatus: 'created',
			},
			'param overrides ChainRecord status': {
				input: {
					record: {
						...rawRecord,
						status: 'updated',
					},
					status: 'created',
				},
				expectedStatus: 'created',
			},
			'strips tree from TreeRecord': {
				input: {
					record: {
						...rawRecord,
						status: 'created',
						tree: [],
					},
				},
				expectedStatus: 'created',
			},
		}

		function act({ input, expectedStatus }: TestCase) {
			const result = toTrackedRecord(input)
			expect(isTrackedRecord(result)).toBe(true)
			expect(result.status).toBe(expectedStatus)
			expect('tree' in result).toBe(false)
		}

		runTestCases.generic(testCases, act)
	})

	describe('toTreeRecord', () => {
		type TestCase = BaseTestCase & {
			input: {
				record:
					| RawRecord<TestConfig, TestElement>
					| TrackedRecord<TestConfig, TestElement>
					| TreeRecord<TestConfig, TestElement>
				status?: 'unchanged' | 'created' | 'updated'
				tree?: TreeRecord<TestConfig, TestElement>[]
			}
			expectedStatus: 'unchanged' | 'created' | 'updated'
			expectedTreeLength: number
		}

		const rawRecord: RawRecord<TestConfig, 'A'> = {
			id: '1',
			tagName: 'A',
			namespace: DIALECTE_NAMESPACES.default,
			attributes: [],
			children: [],
			parent: null,
			value: '',
		} as RawRecord<TestConfig, 'A'>

		const childTree: TreeRecord<TestConfig, 'AA_1'> = {
			id: '2',
			tagName: 'AA_1',
			namespace: DIALECTE_NAMESPACES.default,
			attributes: [],
			children: [],
			parent: null,
			value: '',
			status: 'unchanged',
			tree: [],
		} as TreeRecord<TestConfig, 'AA_1'>

		const testCases: Record<string, TestCase> = {
			'converts RawRecord to TreeRecord with default status and empty tree': {
				input: { record: rawRecord },
				expectedStatus: 'unchanged',
				expectedTreeLength: 0,
			},
			'converts RawRecord to TreeRecord with custom status and tree': {
				input: {
					record: rawRecord,
					status: 'created',
					tree: [childTree] as TreeRecord<TestConfig, TestElement>[],
				},
				expectedStatus: 'created',
				expectedTreeLength: 1,
			},
			'converts ChainRecord to TreeRecord with empty tree': {
				input: {
					record: { ...rawRecord, status: 'updated' } as TreeRecord<TestConfig, TestElement>,
				},
				expectedStatus: 'updated',
				expectedTreeLength: 0,
			},
			'returns TreeRecord unchanged': {
				input: {
					record: {
						...rawRecord,
						status: 'created',
						tree: [childTree],
					} as TreeRecord<TestConfig, TestElement>,
				},
				expectedStatus: 'created',
				expectedTreeLength: 1,
			},
		}

		function act({ input, expectedStatus, expectedTreeLength }: TestCase) {
			const result = toTreeRecord(input)
			expect(isTreeRecord(result)).toBe(true)
			expect(result.status).toBe(expectedStatus)
			expect(result.tree).toHaveLength(expectedTreeLength)
		}

		runTestCases.generic(testCases, act)
	})

	describe('toFullAttributeArray', () => {
		type TestCase = BaseTestCase & {
			input: {
				tagName: 'A'
				attributes:
					| AttributesValueObjectOf<TestConfig, 'A'>
					| FullAttributeObjectOf<TestConfig, 'A'>[]
				dialecteConfig: TestConfig
			}
			expectedLength: number
			isArray: boolean
		}

		const testCases: Record<string, TestCase> = {
			'returns array format unchanged': {
				input: {
					tagName: 'A',
					attributes: { aA: 'val1' },
					dialecteConfig: TEST_DIALECTE_CONFIG,
				},
				expectedLength: 1,
				isArray: true,
			},
			'converts object format to array format': {
				input: {
					tagName: 'A',
					attributes: { aA: 'val1' },
					dialecteConfig: TEST_DIALECTE_CONFIG,
				},
				expectedLength: 1,
				isArray: true,
			},
			'handles empty array': {
				input: {
					tagName: 'A',
					attributes: [] as FullAttributeObjectOf<TestConfig, 'A'>[],
					dialecteConfig: TEST_DIALECTE_CONFIG,
				},
				expectedLength: 0,
				isArray: true,
			},
			'handles empty object': {
				input: {
					tagName: 'A',
					attributes: {} as AttributesValueObjectOf<TestConfig, 'A'>,
					dialecteConfig: TEST_DIALECTE_CONFIG,
				},
				expectedLength: 0,
				isArray: true,
			},
			'converts multiple attributes': {
				input: {
					tagName: 'A',
					attributes: [
						{ name: 'aA', value: 'val1', namespace: DIALECTE_NAMESPACES.default },
						{ name: 'bA', value: 'val2', namespace: DIALECTE_NAMESPACES.default },
					],
					dialecteConfig: TEST_DIALECTE_CONFIG,
				},
				expectedLength: 2,
				isArray: true,
			},
		}

		function act({ input, expectedLength, isArray }: TestCase) {
			const result = toFullAttributeArray(input)
			expect(Array.isArray(result)).toBe(isArray)
			expect(result).toHaveLength(expectedLength)
			result.forEach((attr) => {
				expect(attr).toHaveProperty('name')
				expect(attr).toHaveProperty('value')
			})
		}

		runTestCases.generic(testCases, act)
	})
})
