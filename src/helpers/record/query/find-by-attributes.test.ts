import { findByAttributes, matchesAttributeFilter } from './find-by-attributes'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { CoreChain } from '@/chain-methods'
import { DialecteCore } from '@/dialecte'
import {
	createTestDialecte,
	createTestRecord,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	DEV_ID,
	TEST_DIALECTE_CONFIG,
} from '@/helpers/test-fixtures'

import type { AnyDialecteConfig, AttributesOf, Context, ElementsOf, RawRecord } from '@/types'

type TestConfig = typeof TEST_DIALECTE_CONFIG
type TestElement = ElementsOf<TestConfig>

describe('matchesAttributeFilter', () => {
	type TestCase = {
		desc: string
		record: RawRecord<TestConfig, TestElement>
		attributeFilter:
			| Record<AttributesOf<TestConfig, TestElement>, string | string[] | undefined>
			| undefined
		expected: boolean
		only?: boolean
	}

	const testCases: TestCase[] = [
		{
			desc: 'returns true when no filter is provided',
			record: createTestRecord({
				record: {
					tagName: 'A',
					attributes: [{ name: 'aA', value: 'test1' }],
				},
			}),
			attributeFilter: undefined,
			expected: true,
		},
		{
			desc: 'returns true when filter is empty object',
			record: createTestRecord({
				record: {
					tagName: 'A',
					attributes: [{ name: 'aA', value: 'test1' }],
				},
			}),
			attributeFilter: {},
			expected: true,
		},
		{
			desc: 'matches single attribute value',
			record: createTestRecord({
				record: {
					tagName: 'A',
					attributes: [{ name: 'aA', value: 'test1' }],
				},
			}),
			attributeFilter: { aA: 'test1' },
			expected: true,
		},
		{
			desc: 'does not match when attribute value differs',
			record: createTestRecord({
				record: {
					tagName: 'A',
					attributes: [{ name: 'aA', value: 'test1' }],
				},
			}),
			attributeFilter: { aA: 'test2' },
			expected: false,
		},
		{
			desc: 'matches with array of values (OR logic)',
			record: createTestRecord({
				record: {
					tagName: 'A',
					attributes: [{ name: 'aA', value: 'test2' }],
				},
			}),
			attributeFilter: { aA: ['test1', 'test2', 'test3'] },
			expected: true,
		},
		{
			desc: 'does not match when value is not in array',
			record: createTestRecord({
				record: {
					tagName: 'A',
					attributes: [{ name: 'aA', value: 'test4' }],
				},
			}),
			attributeFilter: { aA: ['test1', 'test2', 'test3'] },
			expected: false,
		},
		{
			desc: 'returns false when attribute is missing',
			record: createTestRecord({
				record: {
					tagName: 'A',
					attributes: [],
				},
			}),
			attributeFilter: { aA: 'test1' },
			expected: false,
		},
		{
			desc: 'requires all attributes to match (AND logic)',
			record: createTestRecord({
				record: {
					tagName: 'AA_1',
					attributes: [{ name: 'aAA_1', value: 'test1' }],
				},
			}),
			attributeFilter: { aAA_1: 'test1' },
			expected: true,
		},
		{
			desc: 'fails when one attribute does not match (AND logic)',
			record: createTestRecord({
				record: {
					tagName: 'AA_1',
					attributes: [{ name: 'aAA_1', value: 'test1' }],
				},
			}),
			attributeFilter: { aAA_1: 'test2' },
			expected: false,
		},
		{
			desc: 'ignores undefined values in filter',
			record: createTestRecord({
				record: {
					tagName: 'A',
					attributes: [{ name: 'aA', value: 'test1' }],
				},
			}),
			attributeFilter: { aA: 'test1', nonExistent: undefined },
			expected: true,
		},
		{
			desc: 'matches with array AND single value combined',
			record: createTestRecord({
				record: {
					tagName: 'A',
					attributes: [{ name: 'aA', value: 'test2' }],
				},
			}),
			attributeFilter: { aA: ['test1', 'test2'] },
			expected: true,
		},
		{
			desc: 'fails when array matches but other attribute does not',
			record: createTestRecord({
				record: {
					tagName: 'A',
					attributes: [{ name: 'aA', value: 'test2' }],
				},
			}),
			attributeFilter: { aA: ['test1', 'test2'], nonExistent: 'value' },
			expected: false,
		},
	]

	let cases = testCases
	const onlyCases = testCases.filter((tc) => tc.only)
	if (onlyCases.length) cases = onlyCases

	cases.forEach(runTest)

	function runTest(tc: TestCase) {
		it(tc.desc, () => {
			const result = matchesAttributeFilter(tc.record, tc.attributeFilter)
			expect(result).toBe(tc.expected)
		})
	}
})

describe('findByAttributes', () => {
	const xml = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="root-id">
		<A ${DEV_ID}="a1" aA="a1" aB="typeA" />
		<A ${DEV_ID}="a2" aA="a2" aB="typeA" />
		<A ${DEV_ID}="a3" aA="a3" aB="typeB" />
		<B ${DEV_ID}="b1" bA="b1" bB="descB" />
		<B ${DEV_ID}="b2" bA="b2" bB="descB" />
	</Root>`

	let dialecte: DialecteCore<TestConfig>
	let context: Context<TestConfig, ElementsOf<TestConfig>>
	let dialecteConfig: TestConfig
	let cleanup: () => Promise<void>

	beforeEach(async () => {
		const result = await createTestDialecte({ xmlString: xml })
		dialecte = result.dialecte
		cleanup = result.cleanup
		dialecteConfig = TEST_DIALECTE_CONFIG
		context = await result.dialecte.fromRoot().getContext()
	})

	afterEach(async () => {
		await cleanup()
	})

	type TestCase = {
		desc: string
		tagName: ElementsOf<TestConfig>
		attributes?: any
		expectedCount: number
		expectedValues?: string[]
		only?: boolean
	}

	const testCases: TestCase[] = [
		{
			desc: 'finds all elements by tag when no filter',
			tagName: 'A',
			attributes: undefined,
			expectedCount: 3,
			expectedValues: ['a1', 'a2', 'a3'],
		},
		{
			desc: 'finds all elements by tag with empty filter',
			tagName: 'A',
			attributes: {},
			expectedCount: 3,
			expectedValues: ['a1', 'a2', 'a3'],
		},
		{
			desc: 'filters by single attribute',
			tagName: 'A',
			attributes: { aB: 'typeA' },
			expectedCount: 2,
			expectedValues: ['a1', 'a2'],
		},
		{
			desc: 'filters by single attribute with different value',
			tagName: 'A',
			attributes: { aB: 'typeB' },
			expectedCount: 1,
			expectedValues: ['a3'],
		},
		{
			desc: 'filters by multiple attributes (AND logic)',
			tagName: 'A',
			attributes: { aA: 'a1', aB: 'typeA' },
			expectedCount: 1,
			expectedValues: ['a1'],
		},
		{
			desc: 'returns empty when no match',
			tagName: 'A',
			attributes: { aA: 'nonexistent' },
			expectedCount: 0,
		},
		{
			desc: 'filters with array of values (OR logic)',
			tagName: 'A',
			attributes: { aA: ['a1', 'a3'] },
			expectedCount: 2,
			expectedValues: ['a1', 'a3'],
		},
		{
			desc: 'finds different tag type',
			tagName: 'B',
			attributes: { bB: 'descB' },
			expectedCount: 2,
			expectedValues: ['b1', 'b2'],
		},
		{
			desc: 'filters with array AND single attribute',
			tagName: 'A',
			attributes: { aA: ['a1', 'a2', 'a3'], aB: 'typeA' },
			expectedCount: 2,
			expectedValues: ['a1', 'a2'],
		},
		{
			desc: 'ignores undefined in filter',
			tagName: 'A',
			attributes: { aA: 'a1', aB: undefined },
			expectedCount: 1,
			expectedValues: ['a1'],
		},
	]

	let cases = testCases
	const onlyCases = testCases.filter((tc) => tc.only)
	if (onlyCases.length) cases = onlyCases

	cases.forEach(runTest)

	function runTest(tc: TestCase) {
		it(tc.desc, async () => {
			const result = await findByAttributes({
				context,
				dialecteConfig,
				databaseInstance: dialecte.getDatabaseInstance(),
				tagName: tc.tagName,
				attributes: tc.attributes,
			})

			expect(result).toHaveLength(tc.expectedCount)

			if (tc.expectedValues) {
				const attrKey = tc.tagName === 'A' ? 'aA' : 'bA'
				const resultValues = result
					.map((r) => r.attributes.find((a) => a.name === attrKey)?.value)
					.sort()
				expect(resultValues).toEqual(tc.expectedValues.sort())
			}
		})
	}
})
