import { matchesAttributeFilter } from './find-by-attributes'

import { describe, expect } from 'vitest'

import { XMLNS_DEFAULT_NAMESPACE, createTestRecord, runTestCases } from '@/test'

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
			sourceXml: /* xml */ `
				<Root ${ns} />
			`,
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
		const result = await source.document.query.findByAttributes({
			tagName: testCase.tagName,
			attributes: testCase.attributes as FilterAttributes<
				TestDialecteConfig,
				typeof testCase.tagName
			>,
		})

		expect(result).toHaveLength(testCase.expectedCount)

		return { assertDatabaseName: source.databaseName }
	}

	runTestCases.withExport({ testCases, act })
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
		const result = matchesAttributeFilter({ record, attributeFilter: tc.attributeFilter })
		expect(result).toBe(tc.expected)
	}

	runTestCases.generic(testCases, act)
})
