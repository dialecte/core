import { getLatestStagedRecord, getRecord, fetchRecords } from '.'

import { describe, it, expect, Test } from 'vitest'

import { AnyDatabaseInstance } from '@/database'
import {
	TEST_DIALECTE_CONFIG,
	createTestRecord,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	ChainTestOperation,
	executeChainOperations,
} from '@/helpers/test-fixtures'

import type { CoreChain } from '@/chain-methods'
import type { Operation, RawRecord, ElementsOf, ChildrenOf } from '@/types'

type TestConfig = typeof TEST_DIALECTE_CONFIG
type TestElement = ElementsOf<TestConfig>

describe('getLatestStagedRecord', () => {
	const testCases: Array<{
		description: string
		stagedOperations: Operation<TestConfig>[]
		id: string
		tagName: TestElement
		throwOnDeleted?: boolean
		expectedResult?: RawRecord<TestConfig, TestElement>
		expectedError?: string
	}> = [
		{
			description: 'should return undefined when no operations exist',
			stagedOperations: [],
			id: 'element-1',
			tagName: 'A',
			expectedResult: undefined,
		},
		{
			description: 'should return undefined when element not found in operations',
			stagedOperations: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: 'other-id', tagName: 'A' } }),
				},
			],
			id: 'element-1',
			tagName: 'A',
			expectedResult: undefined,
		},
		{
			description: 'should return record from create operation',
			stagedOperations: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
				},
			],
			id: 'element-1',
			tagName: 'A',
			expectedResult: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
		},
		{
			description: 'should return newRecord record from update operation',
			stagedOperations: [
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
				},
			],
			id: 'element-1',
			tagName: 'A',
			expectedResult: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
		},
		{
			description: 'should return most recent operation when multiple exist',
			stagedOperations: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
				},
			],
			id: 'element-1',
			tagName: 'A',
			expectedResult: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
		},
		{
			description: 'should throw error when element is deleted (throwOnDeleted=true)',
			stagedOperations: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
				},
				{
					status: 'deleted',
					oldRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
					newRecord: undefined,
				},
			],
			id: 'element-1',
			tagName: 'A',
			throwOnDeleted: true,
			expectedError: 'Element A with id element-1 has been deleted',
		},
		{
			description: 'should return deleted record when element is deleted (throwOnDeleted=false)',
			stagedOperations: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
				},
				{
					status: 'deleted',
					oldRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
					newRecord: undefined,
				},
			],
			id: 'element-1',
			tagName: 'A',
			throwOnDeleted: false,
			expectedResult: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
		},
		{
			description: 'should throw error on tagName mismatch',
			stagedOperations: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'B' } }),
				},
			],
			id: 'element-1',
			tagName: 'A',
			expectedError: 'Element tagName mismatch: expected A, got B for id element-1',
		},
		{
			description: 'should ignore operations for other elements',
			stagedOperations: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: 'other-1', tagName: 'A' } }),
				},
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: 'other-2', tagName: 'A' } }),
					newRecord: createTestRecord({ record: { id: 'other-2', tagName: 'A' } }),
				},
			],
			id: 'element-1',
			tagName: 'A',
			expectedResult: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
		},
		{
			description: 'should handle create followed by update',
			stagedOperations: [
				{
					status: 'created',
					oldRecord: undefined,
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'C' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: 'element-1', tagName: 'C' } }),
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'C' } }),
				},
			],
			id: 'element-1',
			tagName: 'C',
			expectedResult: createTestRecord({ record: { id: 'element-1', tagName: 'C' } }),
		},
		{
			description: 'should search in reverse order (most recent wins)',
			stagedOperations: [
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
				},
				{
					status: 'updated',
					oldRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
					newRecord: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
				},
			],
			id: 'element-1',
			tagName: 'A',
			expectedResult: createTestRecord({ record: { id: 'element-1', tagName: 'A' } }),
		},
	]

	testCases.forEach(
		({
			description,
			stagedOperations,
			id,
			tagName,
			throwOnDeleted,
			expectedResult,
			expectedError,
		}) => {
			it(description, () => {
				const params = {
					stagedOperations,
					id,
					tagName,
					...(throwOnDeleted !== undefined && { throwOnDeleted }),
				}

				if (expectedError) {
					expect(() => getLatestStagedRecord(params)).toThrow(expectedError)
				} else {
					const result = getLatestStagedRecord(params)
					if (expectedResult === undefined) {
						expect(result).toEqual(undefined)
					} else {
						expect(result?.record).toEqual(expectedResult)
					}
				}
			})
		},
	)
})

describe('getRecord', () => {
	type TestElement = ElementsOf<TestConfig>
	type ChildElement = ChildrenOf<TestConfig, TestElement>

	type TestCase = {
		description: string
		xml: string
		operations: ChainTestOperation<TestConfig, TestElement, ChildElement>[]
		fetchParams: { id: string; tagName: TestElement }
		expected: {
			exists: boolean
			tagName?: TestElement
		}
	}

	const testCases: TestCase[] = [
		{
			description: 'returns record from database when no staged operations',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value" /></Root>`,
			operations: [],
			fetchParams: { id: '2', tagName: 'A' },
			expected: { exists: true, tagName: 'A' },
		},
		{
			description: 'returns record from staged operations instead of database',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			operations: [
				{
					type: 'addChild',
					id: '0-0-0-0-1',
					tagName: 'A',
					attributes: { aA: 'value' },
					setFocus: false,
				},
			],
			fetchParams: { id: '0-0-0-0-1', tagName: 'A' },
			expected: { exists: true, tagName: 'A' },
		},
		{
			description: 'returns undefined for deleted element',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value" /></Root>`,
			operations: [
				{
					type: 'delete',
					goTo: { tagName: 'A', id: '2' },
				},
			],
			fetchParams: { id: '2', tagName: 'A' },
			expected: { exists: false },
		},
		{
			description: 'returns updated record from staged operations',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="old" /></Root>`,
			operations: [
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'new' },
				},
			],
			fetchParams: { id: '2', tagName: 'A' },
			expected: { exists: true, tagName: 'A' },
		},
	]

	testCases.forEach(({ description, xml, operations, fetchParams, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

			try {
				const context = await executeChainOperations<TestConfig, TestElement, ChildElement>({
					chain: dialecte.fromRoot() as CoreChain<TestConfig, TestElement>,
					operations,
				})

				const databaseInstance = dialecte.getDatabaseInstance()
				const { id, tagName } = fetchParams
				const record = await getRecord<TestConfig, TestElement>({
					id,
					tagName,
					stagedOperations: context.stagedOperations,
					dialecteConfig: TEST_DIALECTE_CONFIG,
					databaseInstance,
				})

				if (expected.exists) {
					expect(record).toBeDefined()
					expect(record?.tagName).toBe(expected.tagName)
				} else {
					expect(record).toBeUndefined()
				}
			} finally {
				await cleanup()
			}
		})
	})
})

describe('fetchRecords', () => {
	type TestElement = ElementsOf<TestConfig>
	type ChildElement = ChildrenOf<TestConfig, TestElement>

	type TestCase = {
		description: string
		xml: string
		operations: ChainTestOperation<TestConfig, TestElement, ChildElement>[]
		fetchParams: { tagName: TestElement; type?: 'raw' | 'dialecte' }
		expected: {
			count: number
			ids?: string[]
			statuses?: Record<string, 'created' | 'updated' | 'unchanged'>
		}
	}

	const testCases: TestCase[] = [
		{
			description: 'returns empty array when no records exist',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			operations: [],
			fetchParams: { tagName: 'A' },
			expected: { count: 0 },
		},
		{
			description: 'returns records from database when no staged operations',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="v1" /><A ${DEV_ID}="3" aA="v2" /></Root>`,
			operations: [],
			fetchParams: { tagName: 'A' },
			expected: { count: 2, ids: ['2', '3'] },
		},
		{
			description: 'includes created records from staged operations',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			operations: [
				{
					type: 'addChild',
					id: '0-0-0-0-1',
					tagName: 'A',
					attributes: { aA: 'v1' },
					setFocus: false,
				},
				{
					type: 'addChild',
					id: '0-0-0-0-2',
					tagName: 'A',
					attributes: { aA: 'v2' },
					setFocus: false,
				},
			],
			fetchParams: { tagName: 'A' },
			expected: { count: 2, ids: ['0-0-0-0-1', '0-0-0-0-2'] },
		},
		{
			description: 'merges database records with created staged records',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="v1" /></Root>`,
			operations: [
				{
					type: 'addChild',
					id: '0-0-0-0-1',
					tagName: 'A',
					attributes: { aA: 'v2' },
					setFocus: false,
				},
			],
			fetchParams: { tagName: 'A' },
			expected: { count: 2, ids: ['2', '0-0-0-0-1'] },
		},
		{
			description: 'returns updated records from staged operations',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="old" /></Root>`,
			operations: [
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'new' },
				},
			],
			fetchParams: { tagName: 'A' },
			expected: { count: 1, ids: ['2'] },
		},
		{
			description: 'excludes deleted records from staged operations',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="v1" /><A ${DEV_ID}="3" aA="v2" /></Root>`,
			operations: [
				{
					type: 'delete',
					goTo: { tagName: 'A', id: '2' },
				},
			],
			fetchParams: { tagName: 'A' },
			expected: { count: 1, ids: ['3'] },
		},
		{
			description: 'handles mixed operations (create, update, delete)',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="v1" /><A ${DEV_ID}="3" aA="v2" /></Root>`,
			operations: [
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'updated' },
				},
				{
					type: 'addChild',
					id: '0-0-0-0-1',
					tagName: 'A',
					attributes: { aA: 'created' },
					setFocus: false,
				},
				{
					type: 'delete',
					goTo: { tagName: 'A', id: '3' },
				},
			],
			fetchParams: { tagName: 'A' },
			expected: { count: 2, ids: ['2', '0-0-0-0-1'] },
		},
		{
			description: 'handles multiple updates to same record',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="v1" /></Root>`,
			operations: [
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'v2' },
				},
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'v3' },
				},
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'final' },
				},
			],
			fetchParams: { tagName: 'A' },
			expected: { count: 1, ids: ['2'] },
		},
	]

	testCases.forEach(({ description, xml, operations, fetchParams, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

			try {
				const context = await executeChainOperations<TestConfig, TestElement, ChildElement>({
					chain: dialecte.fromRoot() as CoreChain<TestConfig, TestElement>,
					operations,
				})

				const databaseInstance = dialecte.getDatabaseInstance()
				const { tagName } = fetchParams
				const records = await fetchRecords<TestConfig, TestElement>({
					tagName,
					stagedOperations: context.stagedOperations,
					dialecteConfig: TEST_DIALECTE_CONFIG,
					databaseInstance,
				})

				expect(records.length).toBe(expected.count)

				if (expected.ids) {
					const recordIds = records.map((r) => r.id).sort()
					expect(recordIds).toEqual([...expected.ids].sort())
				}
			} finally {
				await cleanup()
			}
		})
	})

	it('includes status property when type=dialecte', async () => {
		const xml = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="v1" /></Root>`
		const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

		try {
			const context = await executeChainOperations<TestConfig, TestElement, ChildElement>({
				chain: dialecte.fromRoot() as CoreChain<TestConfig, TestElement>,
				operations: [
					{
						type: 'addChild',
						id: '0-0-0-0-1',
						tagName: 'A',
						attributes: { aA: 'v2' },
						setFocus: false,
					},
					{
						type: 'update',
						goTo: { tagName: 'A', id: '2' },
						attributes: { aA: 'updated' },
					},
				],
			})

			const databaseInstance = dialecte.getDatabaseInstance()
			const records = await fetchRecords<TestConfig, TestElement>({
				tagName: 'A',
				stagedOperations: context.stagedOperations,
				dialecteConfig: TEST_DIALECTE_CONFIG,
				databaseInstance,
				type: 'chain',
			})

			expect(records.length).toBe(2)
			records.forEach((record) => {
				expect(record).toHaveProperty('status')
				expect(['created', 'updated', 'unchanged']).toContain(record.status)
			})
		} finally {
			await cleanup()
		}
	})

	it('excludes status property when type=raw', async () => {
		const xml = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="v1" /></Root>`
		const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

		try {
			const context = await executeChainOperations<TestConfig, TestElement, ChildElement>({
				chain: dialecte.fromRoot(),
				operations: [
					{
						type: 'addChild',
						id: '0-0-0-0-1',
						tagName: 'A',
						attributes: { aA: 'v2' },
						setFocus: false,
					},
				],
			})

			const databaseInstance = dialecte.getDatabaseInstance()
			const records = await fetchRecords<TestConfig, TestElement>({
				tagName: 'A',
				stagedOperations: context.stagedOperations,
				dialecteConfig: TEST_DIALECTE_CONFIG,
				databaseInstance,
				type: 'raw',
			})

			expect(records.length).toBe(2)
			records.forEach((record) => {
				expect(record).not.toHaveProperty('status')
			})
		} finally {
			await cleanup()
		}
	})

	it('excludes status property when type is omitted', async () => {
		const xml = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="v1" /></Root>`
		const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

		try {
			const records = await fetchRecords({
				tagName: 'A',
				stagedOperations: [],
				dialecteConfig: TEST_DIALECTE_CONFIG,
				databaseInstance: dialecte.getDatabaseInstance(),
			})

			expect(records.length).toBe(1)
			records.forEach((record) => {
				expect(record).not.toHaveProperty('status')
			})
		} finally {
			await cleanup()
		}
	})
})
