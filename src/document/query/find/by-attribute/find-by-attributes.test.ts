import { matchesAttributeFilter } from './find-by-attributes'

import { describe, expect, it } from 'vitest'

import {
	DIALECTE_NAMESPACES,
	XMLNS_DEFAULT_NAMESPACE,
	createXmlAssertions,
	createTestDialecte,
	createTestRecord,
} from '@/test'

import type { FilterAttributes } from './find-by-attributes.types'
import type { TestDialecteConfig } from '@/test'
import type { TrackedRecord } from '@/types'

const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_NAMESPACES,
})

// ---------------------------------------------------------------------------
// findByAttributes — requires DB via createTestDialecte
// ---------------------------------------------------------------------------

describe('findByAttributes', () => {
	type TestCase = {
		xmlString: string
		tagName: 'A' | 'B'
		attributes?:
			| FilterAttributes<TestDialecteConfig, 'A'>
			| FilterAttributes<TestDialecteConfig, 'B'>
		expectedCount: number
		expectedElementQueries?: string[]
		unexpectedElementQueries?: string[]
	}

	const ns = XMLNS_DEFAULT_NAMESPACE

	const testCases: Record<string, TestCase> = {
		'returns all records when no attribute filter': {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A aA="first" />
					<A aA="second" />
				</Root>
			`,
			tagName: 'A',
			attributes: undefined,
			expectedCount: 2,
			expectedElementQueries: [
				'//default:Root/default:A[@aA="first"]',
				'//default:Root/default:A[@aA="second"]',
			],
		},
		'returns matching records for single attribute value': {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A aA="match" />
					<A aA="no-match" />
				</Root>
			`,
			tagName: 'A',
			attributes: { aA: 'match' },
			expectedCount: 1,
			expectedElementQueries: ['//default:A[@aA="match"]'],
			unexpectedElementQueries: ['//default:A[@aA="wrong"]'],
		},
		'returns empty array when no records match': {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A aA="other" />
				</Root>
			`,
			tagName: 'A',
			attributes: { aA: 'match' },
			expectedCount: 0,
			unexpectedElementQueries: ['//default:A[@aA="match"]'],
		},
		'returns records matching array of values (OR logic)': {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A aA="x" />
					<A aA="y" />
					<A aA="z" />
				</Root>
			`,
			tagName: 'A',
			attributes: { aA: ['x', 'y'] },
			expectedCount: 2,
			expectedElementQueries: ['//default:A[@aA="x"]', '//default:A[@aA="y"]'],
			unexpectedElementQueries: ['//default:A[@aA="not-present"]'],
		},
		'returns records matching all attributes (AND logic)': {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A aA="x" bA="y" />
					<A aA="x" bA="z" />
				</Root>
			`,
			tagName: 'A',
			attributes: { aA: 'x', bA: 'y' },
			expectedCount: 1,
			expectedElementQueries: ['//default:A[@aA="x"][@bA="y"]'],
			unexpectedElementQueries: ['//default:A[@bA="not-present"]'],
		},
		'returns empty array when tagName has no records in store': {
			xmlString: /* xml */ `
				<Root ${ns} />
			`,
			tagName: 'A',
			attributes: undefined,
			expectedCount: 0,
			unexpectedElementQueries: ['//default:A'],
		},
		'filters by tagName — does not return other element types': {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A aA="val" />
					<B aB="val" />
				</Root>
			`,
			tagName: 'B',
			attributes: { aB: 'val' } as FilterAttributes<TestDialecteConfig, 'B'>,
			expectedCount: 1,
			expectedElementQueries: ['//default:B[@aB="val"]'],
		},
	}

	it.each(Object.entries(testCases))('%s', async (_, tc) => {
		const { document, exportCurrentTest, cleanup } = await createTestDialecte({
			xmlString: tc.xmlString,
		})

		try {
			const result = await document.query.findByAttributes({
				tagName: tc.tagName,
				attributes: tc.attributes as FilterAttributes<TestDialecteConfig, typeof tc.tagName>,
			})

			expect(result).toHaveLength(tc.expectedCount)

			const { xmlDocument } = await exportCurrentTest()

			if (tc.expectedElementQueries) {
				assertExpectedElementQueries({ xmlDocument, queries: tc.expectedElementQueries })
			}

			if (tc.unexpectedElementQueries) {
				assertUnexpectedElementQueries({ xmlDocument, queries: tc.unexpectedElementQueries })
			}
		} finally {
			await cleanup()
		}
	})
})

// ---------------------------------------------------------------------------
// matchesAttributeFilter — pure sync, no DB
// ---------------------------------------------------------------------------

describe('matchesAttributeFilter', () => {
	type TestCase = {
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

	it.each(Object.entries(testCases))('%s', (_, tc) => {
		const record = createTestRecord({
			type: 'tracked',
			record: {
				tagName: 'A',
				attributes: tc.attributes as TrackedRecord<TestDialecteConfig, 'A'>['attributes'],
			},
		})
		const result = matchesAttributeFilter({ record, attributeFilter: tc.attributeFilter })
		expect(result).toBe(tc.expected)
	})
})
