import { TEST_DIALECTE_CONFIG, DIALECTE_NAMESPACES } from '../test-fixtures'
import { toChainRecord, toRawRecord, toTreeRecord, toFullAttributeArray } from './converter'
import { isRawRecord, isChainRecord, isTreeRecord } from './guard'

import { describe, it, expect } from 'vitest'

import type {
	RawRecord,
	ChainRecord,
	TreeRecord,
	ElementsOf,
	FullAttributeObjectOf,
	AttributesValueObjectOf,
	AnyDialecteConfig,
} from '@/types'

describe('Record Converter', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	describe('toRawRecord', () => {
		type TestCase = {
			desc: string
			input:
				| RawRecord<TestConfig, TestElement>
				| ChainRecord<TestConfig, TestElement>
				| TreeRecord<TestConfig, TestElement>
			expectedKeys: number
		}

		const testCases: TestCase[] = [
			{
				desc: 'converts ChainRecord to RawRecord by stripping status',
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
			{
				desc: 'converts TreeRecord to RawRecord by stripping status and tree',
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
			{
				desc: 'returns RawRecord unchanged',
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
		]

		testCases.forEach(({ desc, input, expectedKeys }) => {
			it(desc, () => {
				const result = toRawRecord(input)
				expect(Object.keys(result)).toHaveLength(expectedKeys)
				expect(isRawRecord(result)).toBe(true)
				expect('status' in result).toBe(false)
				expect('tree' in result).toBe(false)
			})
		})
	})

	describe('toChainRecord', () => {
		type TestCase = {
			desc: string
			input: {
				record:
					| RawRecord<TestConfig, 'A'>
					| ChainRecord<TestConfig, 'A'>
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

		const testCases: TestCase[] = [
			{
				desc: 'converts RawRecord to ChainRecord with default status=unchanged',
				input: { record: rawRecord },
				expectedStatus: 'unchanged',
			},
			{
				desc: 'converts RawRecord to ChainRecord with custom status',
				input: { record: rawRecord, status: 'created' },
				expectedStatus: 'created',
			},
			{
				desc: 'param overrides ChainRecord status',
				input: {
					record: {
						...rawRecord,
						status: 'updated',
					},
					status: 'created',
				},
				expectedStatus: 'created',
			},
			{
				desc: 'strips tree from TreeRecord',
				input: {
					record: {
						...rawRecord,
						status: 'created',
						tree: [],
					},
				},
				expectedStatus: 'created',
			},
		]

		testCases.forEach(({ desc, input, expectedStatus }) => {
			it(desc, () => {
				const result = toChainRecord(input)
				expect(isChainRecord(result)).toBe(true)
				expect(result.status).toBe(expectedStatus)
				expect('tree' in result).toBe(false)
			})
		})
	})

	describe('toTreeRecord', () => {
		type TestCase = {
			desc: string
			input: {
				record:
					| RawRecord<TestConfig, TestElement>
					| ChainRecord<TestConfig, TestElement>
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

		const testCases: TestCase[] = [
			{
				desc: 'converts RawRecord to TreeRecord with default status and empty tree',
				input: { record: rawRecord },
				expectedStatus: 'unchanged',
				expectedTreeLength: 0,
			},
			{
				desc: 'converts RawRecord to TreeRecord with custom status and tree',
				input: {
					record: rawRecord,
					status: 'created',
					tree: [childTree] as TreeRecord<TestConfig, TestElement>[],
				},
				expectedStatus: 'created',
				expectedTreeLength: 1,
			},
			{
				desc: 'converts ChainRecord to TreeRecord with empty tree',
				input: {
					record: { ...rawRecord, status: 'updated' } as TreeRecord<TestConfig, TestElement>,
				},
				expectedStatus: 'updated',
				expectedTreeLength: 0,
			},
			{
				desc: 'returns TreeRecord unchanged',
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
		]

		testCases.forEach(({ desc, input, expectedStatus, expectedTreeLength }) => {
			it(desc, () => {
				const result = toTreeRecord(input)
				expect(isTreeRecord(result)).toBe(true)
				expect(result.status).toBe(expectedStatus)
				expect(result.tree).toHaveLength(expectedTreeLength)
			})
		})
	})

	describe('toFullAttributeArray', () => {
		type TestCase = {
			desc: string
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

		const testCases: TestCase[] = [
			{
				desc: 'returns array format unchanged',
				input: {
					tagName: 'A',
					attributes: { aA: 'val1' },
					dialecteConfig: TEST_DIALECTE_CONFIG,
				},
				expectedLength: 1,
				isArray: true,
			},
			{
				desc: 'converts object format to array format',
				input: {
					tagName: 'A',
					attributes: { aA: 'val1' },
					dialecteConfig: TEST_DIALECTE_CONFIG,
				},
				expectedLength: 1,
				isArray: true,
			},
			{
				desc: 'handles empty array',
				input: {
					tagName: 'A',
					attributes: [] as FullAttributeObjectOf<TestConfig, 'A'>[],
					dialecteConfig: TEST_DIALECTE_CONFIG,
				},
				expectedLength: 0,
				isArray: true,
			},
			{
				desc: 'handles empty object',
				input: {
					tagName: 'A',
					attributes: {} as AttributesValueObjectOf<TestConfig, 'A'>,
					dialecteConfig: TEST_DIALECTE_CONFIG,
				},
				expectedLength: 0,
				isArray: true,
			},
			{
				desc: 'converts multiple attributes',
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
		]

		testCases.forEach(({ desc, input, expectedLength, isArray }) => {
			it(desc, () => {
				const result = toFullAttributeArray(input)
				expect(Array.isArray(result)).toBe(isArray)
				expect(result).toHaveLength(expectedLength)
				result.forEach((attr) => {
					expect(attr).toHaveProperty('name')
					expect(attr).toHaveProperty('value')
				})
			})
		})
	})
})
