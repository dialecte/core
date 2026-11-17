import { matchesAttributeFilter } from './find-by-attributes'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers/constant'
import {
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRecord,
	runTestCases,
} from '@/test'

import type { FilterAttributes } from './find-by-attributes.types'
import type {
	ActParams,
	ActResult,
	BaseTestCase,
	BaseXmlTestCase,
	TestCases,
	TestDialecteConfig,
} from '@/test'
import type { TrackedRecord } from '@/types'

// ---------------------------------------------------------------------------
// findByAttributes — requires DB via createTestDialecte
// ---------------------------------------------------------------------------

describe('findByAttributes', () => {
	type TestCase = BaseXmlTestCase & {
		tagName: 'A' | 'B'
		attributes?:
			| FilterAttributes<TestDialecteConfig, 'A'>
			| FilterAttributes<TestDialecteConfig, 'B'>
		expectedCount: number
	}

	const ns = XMLNS_DEFAULT_NAMESPACE

	const testCases: TestCases<TestCase> = {
		'returns all records when no attribute filter': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="first" />
					<A aA="second" />
				</Root>
			`,
			tagName: 'A',
			attributes: undefined,
			expectedCount: 2,
			expectedQueries: [
				'//default:Root/default:A[@aA="first"]',
				'//default:Root/default:A[@aA="second"]',
			],
		},
		'returns matching records for single attribute value': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="match" />
					<A aA="no-match" />
				</Root>
			`,
			tagName: 'A',
			attributes: { aA: 'match' },
			expectedCount: 1,
			expectedQueries: ['//default:A[@aA="match"]'],
			unexpectedQueries: ['//default:A[@aA="wrong"]'],
		},
		'returns empty array when no records match': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="other" />
				</Root>
			`,
			tagName: 'A',
			attributes: { aA: 'match' },
			expectedCount: 0,
			unexpectedQueries: ['//default:A[@aA="match"]'],
		},
		'returns records matching array of values (OR logic)': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="x" />
					<A aA="y" />
					<A aA="z" />
				</Root>
			`,
			tagName: 'A',
			attributes: { aA: ['x', 'y'] },
			expectedCount: 2,
			expectedQueries: ['//default:A[@aA="x"]', '//default:A[@aA="y"]'],
			unexpectedQueries: ['//default:A[@aA="not-present"]'],
		},
		'returns records matching all attributes (AND logic)': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="x" bA="y" />
					<A aA="x" bA="z" />
				</Root>
			`,
			tagName: 'A',
			attributes: { aA: 'x', bA: 'y' },
			expectedCount: 1,
			expectedQueries: ['//default:A[@aA="x"][@bA="y"]'],
			unexpectedQueries: ['//default:A[@bA="not-present"]'],
		},
		'returns empty array when tagName has no records in store': {
			sourceXml: /* xml */ `<Root ${ns} />`,
			tagName: 'A',
			attributes: undefined,
			expectedCount: 0,
			unexpectedQueries: ['//default:A'],
		},
		'filters by tagName — does not return other element types': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="val" />
					<B aB="val" />
				</Root>
			`,
			tagName: 'B',
			attributes: { aB: 'val' } as FilterAttributes<TestDialecteConfig, 'B'>,
			expectedCount: 1,
			expectedQueries: ['//default:B[@aB="val"]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const result = await source.query.findByAttributes({
			tagName: testCase.tagName,
			attributes: testCase.attributes as FilterAttributes<
				TestDialecteConfig,
				typeof testCase.tagName
			>,
		})

		expect(result).toHaveLength(testCase.expectedCount)

		return {}
	}

	runTestCases.withExport({ testCases, act })
})

const VALUES_SOURCE_XML = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}>
		<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="a3" aA="v3"/>
		<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="a1" aA="v1"/>
		<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="a2" aA="v2"/>
	</Root>
`

type ValuesTestCase = BaseXmlTestCase & { values: string[]; expectedIds: string[] }

describe('findByAttributes - a list of values after the import', () => {
	const testCases: TestCases<ValuesTestCase> = {
		'a list of values → each element holding one, in id order': {
			sourceXml: VALUES_SOURCE_XML,
			values: ['v3', 'v1', 'none'],
			expectedIds: ['a1', 'a3'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, ValuesTestCase>): Promise<void> {
		const found = await source.query.findByAttributes({
			tagName: 'A',
			attributes: { aA: testCase.values },
		})
		expect(found.map((record) => record.id)).toEqual(testCase.expectedIds)
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('findByAttributes - tx.update, then the lookup in the same transaction', () => {
	const testCases: TestCases<ValuesTestCase & { updated: string }> = {
		'an element updated to the value → found with the others, in id order': {
			sourceXml: VALUES_SOURCE_XML,
			updated: 'a2',
			values: ['v', 'v1'],
			expectedIds: ['a1', 'a2'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, ValuesTestCase & { updated: string }>): Promise<void> {
		let ids: string[] = []
		await source.transaction(async function updateThenLookUp(tx) {
			await tx.update({ tagName: 'A', id: testCase.updated }, { attributes: { aA: 'v' } })
			const found = await tx.findByAttributes({ tagName: 'A', attributes: { aA: testCase.values } })
			ids = found.map((record) => record.id)
		})
		expect(ids).toEqual(testCase.expectedIds)
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('findByAttributes - a QName-typed attribute', () => {
	type TestCase = BaseXmlTestCase & {
		attributes: FilterAttributes<TestDialecteConfig, 'EE_1'>
		expectedCount: number
	}

	const sourceXml = /* xml */ `
		<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:q="http://www.w3.org/2001/XMLSchema" xmlns:f="urn:f">
			<E aE="e"><EE_1 aEE_1="q:integer"/></E>
			<E aE="e"><EE_1 aEE_1="f:Thing"/></E>
		</Root>
	`

	const testCases: TestCases<TestCase> = {
		'a filter in the stored form xs:integer → the record the file wrote q:integer': {
			sourceXml,
			attributes: { aEE_1: 'xs:integer' },
			expectedCount: 1,
		},
		'a filter as a Clark name of XSD → the record the file wrote q:integer': {
			sourceXml,
			attributes: { aEE_1: '{http://www.w3.org/2001/XMLSchema}integer' },
			expectedCount: 1,
		},
		'a filter as a foreign Clark name → the record the file wrote f:Thing': {
			sourceXml,
			attributes: { aEE_1: '{urn:f}Thing' },
			expectedCount: 1,
		},
		'a filter with a prefix outside the engine table → no record': {
			sourceXml,
			attributes: { aEE_1: 'f:Thing' },
			expectedCount: 0,
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.findByAttributes({
			tagName: 'EE_1',
			attributes: testCase.attributes,
		})
		expect(result).toHaveLength(testCase.expectedCount)
	}

	runTestCases.withoutExport({ testCases, act })
})

// ---------------------------------------------------------------------------
// matchesAttributeFilter — pure sync, no DB
// ---------------------------------------------------------------------------

describe('matchesAttributeFilter', () => {
	type TestCase = BaseTestCase & {
		attributes: { name: string; value: string }[]
		attributeFilter: FilterAttributes<TestDialecteConfig, 'A'>
		expected: boolean
	}

	const testCases: Record<string, TestCase> = {
		'empty filter object matches any record': {
			attributes: [],
			attributeFilter: {},
			expected: true,
		},
		'single attribute value matches': {
			attributes: [{ name: 'aA', value: 'match' }],
			attributeFilter: { aA: 'match' },
			expected: true,
		},
		'single attribute value does not match': {
			attributes: [{ name: 'aA', value: 'no-match' }],
			attributeFilter: { aA: 'match' },
			expected: false,
		},
		'array OR logic — matches one value': {
			attributes: [{ name: 'aA', value: 'b' }],
			attributeFilter: { aA: ['a', 'b', 'c'] },
			expected: true,
		},
		'array OR logic — matches none': {
			attributes: [{ name: 'aA', value: 'd' }],
			attributeFilter: { aA: ['a', 'b', 'c'] },
			expected: false,
		},
		'multiple attributes AND logic — all match': {
			attributes: [
				{ name: 'aA', value: 'x' },
				{ name: 'bA', value: 'y' },
			],
			attributeFilter: { aA: 'x', bA: 'y' },
			expected: true,
		},
		'multiple attributes AND logic — one fails': {
			attributes: [
				{ name: 'aA', value: 'x' },
				{ name: 'bA', value: 'wrong' },
			],
			attributeFilter: { aA: 'x', bA: 'y' },
			expected: false,
		},
		'missing attribute returns false': {
			attributes: [],
			attributeFilter: { aA: 'something' },
			expected: false,
		},
		'undefined filter value is ignored': {
			attributes: [{ name: 'aA', value: 'x' }],
			attributeFilter: { aA: 'x', bA: undefined },
			expected: true,
		},
	}

	function act(tc: TestCase) {
		const record = createTestRecord({
			type: 'tracked',
			record: {
				tagName: 'A',
				attributes: tc.attributes as TrackedRecord<TestDialecteConfig, 'A'>['attributes'],
			},
		})
		const result = matchesAttributeFilter({
			dialecteConfig: TEST_DIALECTE_CONFIG,
			record,
			attributeFilter: tc.attributeFilter,
		})
		expect(result).toBe(tc.expected)
	}

	runTestCases.generic(testCases, act)
})
