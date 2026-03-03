import { describe, it, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/test-fixtures'

import type { DescendantsFilter } from './types'
import type { FromElementParams } from '@/dialecte'
import type { ElementsOf } from '@/types'

describe('findDescendants (new API)', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	type TestCase = {
		description: string
		xml: string
		startFrom: FromElementParams<TestConfig, TestElement>
		filter?: DescendantsFilter<TestConfig>
		expected: Record<string, { count: number; ids?: string[] }>
	}

	const testCases: TestCase[] = [
		{
			description: 'finds single level descendants',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="value">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="child" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: { tagName: 'AA_1' },
			expected: {
				AA_1: { count: 1, ids: ['3'] },
			},
		},
		{
			description: 'finds nested descendants with path',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="a">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="aa">
							<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aAAA_1="aaa" />
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
					descendant: {
						tagName: 'AAA_1',
					},
				},
			},
			expected: {
				A: { count: 1, ids: ['2'] },
				AA_1: { count: 1, ids: ['3'] },
				AAA_1: { count: 1, ids: ['4'] },
			},
		},
		{
			description: 'enforces path context - only descendants of filtered parent',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="match">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="child1" />
					</A>
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aA="nomatch">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aAA_1="child2" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				attributes: { aA: 'match' },
				descendant: {
					tagName: 'AA_1',
				},
			},

			expected: {
				A: { count: 1, ids: ['2'] },
				AA_1: { count: 1, ids: ['3'] }, // Only child of A[aA=match]
			},
		},
		{
			description: 'filters by attributes at multiple levels',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="a1">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="aa1" />
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aAA_1="aa2" />
					</A>
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aA="a2">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="6" aAA_1="aa1" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				attributes: { aA: 'a1' },
				descendant: {
					tagName: 'AA_1',
					attributes: { aAA_1: 'aa1' },
				},
			},

			expected: {
				A: { count: 1, ids: ['2'] },
				AA_1: { count: 1, ids: ['3'] }, // Only AA_1[aAA_1=aa1] under A[aA=a1]
			},
		},
		{
			description: 'supports OR matching with array attribute values',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="opt1">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="c1" />
					</A>
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aA="opt2">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aAA_1="c2" />
					</A>
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="6" aA="opt3">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="7" aAA_1="c3" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				attributes: { aA: ['opt1', 'opt3'] },
				descendant: {
					tagName: 'AA_1',
				},
			},
			expected: {
				A: { count: 2, ids: ['2', '6'] },
				AA_1: { count: 2, ids: ['3', '7'] }, // Only under opt1 and opt3
			},
		},
		{
			description: 'deduplicates ancestors from multiple paths',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="shared">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="c1" />
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aAA_1="c2" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
				},
			},
			expected: {
				A: { count: 1, ids: ['2'] }, // Same A appears only once despite 2 children
				AA_1: { count: 2, ids: ['3', '4'] },
			},
		},
		{
			description: 'skips intermediate levels with DescendantsOf',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="a">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="aa">
							<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aAAA_1="aaa">
								<AAAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aAAAA_1="aaaa" />
							</AAA_1>
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AAAA_1', // Skip AA_1 and AAA_1 (optional, no attributes)
				},
			},
			expected: {
				A: { count: 1, ids: ['2'] },
				AAAA_1: { count: 1, ids: ['5'] },
				// AA_1 and AAA_1 not collected (not in filter)
			},
		},
		{
			description: 'returns empty arrays when no matches',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="value">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="nomatch" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
					attributes: { aAA_1: 'match' },
				},
			},
			expected: {
				A: { count: 0 },
				AA_1: { count: 0 },
			},
		},
		{
			description: 'returns empty arrays when element has no descendants',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="value" />
				</Root>
			`,
			startFrom: { tagName: 'A', id: '2' },
			filter: { tagName: 'AA_1' },
			expected: {
				AA_1: { count: 0 },
			},
		},
		{
			description: 'handles deeply nested paths',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="a">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="aa">
							<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aAAA_1="aaa">
								<AAAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aAAAA_1="aaaa" />
							</AAA_1>
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
					descendant: {
						tagName: 'AAA_1',
						descendant: {
							tagName: 'AAAA_1',
						},
					},
				},
			},
			expected: {
				A: { count: 1, ids: ['2'] },
				AA_1: { count: 1, ids: ['3'] },
				AAA_1: { count: 1, ids: ['4'] },
				AAAA_1: { count: 1, ids: ['5'] },
			},
		},
		{
			description: 'finds multiple matches at deepest level',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="a">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="aa1" />
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aAA_1="aa2" />
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aAA_1="aa3" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
				},
			},
			expected: {
				A: { count: 1, ids: ['2'] },
				AA_1: { count: 3, ids: ['3', '4', '5'] },
			},
		},
		{
			description: 'filters across multiple branches',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="match">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="c1" />
					</A>
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aA="match">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aAA_1="c2" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				attributes: { aA: 'match' },
				descendant: {
					tagName: 'AA_1',
				},
			},
			expected: {
				A: { count: 2, ids: ['2', '4'] },
				AA_1: { count: 2, ids: ['3', '5'] },
			},
		},
		{
			description: 'combines attribute filters with path at different levels',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="a1" bA="b1">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="aa1" bAA_1="bb1" />
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aAA_1="aa2" bAA_1="bb2" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				attributes: { aA: 'a1', bA: 'b1' },
				descendant: {
					tagName: 'AA_1',
					attributes: { aAA_1: 'aa1' },
				},
			},
			expected: {
				A: { count: 1, ids: ['2'] },
				AA_1: { count: 1, ids: ['3'] },
			},
		},
		{
			description: 'works with single tag in filter (no descendants)',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="a1" />
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aA="a2" />
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				attributes: { aA: 'a1' },
			},
			expected: {
				A: { count: 1, ids: ['2'] },
			},
		},
		{
			description: 'no filter: returns all descendants grouped by tag',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="a">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="aa">
							<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aAAA_1="aaa" />
						</AA_1>
					</A>
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aA="a2">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="6" aAA_1="aa2" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			expected: {
				A: { count: 2, ids: ['2', '5'] },
				AA_1: { count: 2, ids: ['3', '6'] },
				AAA_1: { count: 1, ids: ['4'] },
			},
		},
		{
			description: 'no filter: empty result when element has no descendants',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="value" />
				</Root>
			`,
			startFrom: { tagName: 'A', id: '2' },
			expected: {},
		},
		{
			description: 'no filter: handles deeply nested tree',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="a">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="aa">
							<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aAAA_1="aaa">
								<AAAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aAAAA_1="aaaa" />
							</AAA_1>
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			expected: {
				A: { count: 1, ids: ['2'] },
				AA_1: { count: 1, ids: ['3'] },
				AAA_1: { count: 1, ids: ['4'] },
				AAAA_1: { count: 1, ids: ['5'] },
			},
		},
		{
			description: 'no filter: collects from multiple branches',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aA="a1">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aAA_1="aa1" />
						<AA_2 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aAA_2="aa2" />
					</A>
					<B ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aB="b1">
						<BB_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="6" aBB_1="bb1" />
					</B>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			expected: {
				A: { count: 1, ids: ['2'] },
				AA_1: { count: 1, ids: ['3'] },
				AA_2: { count: 1, ids: ['4'] },
				B: { count: 1, ids: ['5'] },
				BB_1: { count: 1, ids: ['6'] },
			},
		},
		{
			description: 'optional intermediates: multiple nested levels collected',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aFC="fc">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aSC1="sc1">
							<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aSC2="sc2">
								<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aSC3="sc3">
									<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="6" aFCR="fcr" />
								</AA_1>
							</AA_1>
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
					descendant: {
						tagName: 'AAA_1',
					},
				},
			},
			expected: {
				A: { count: 1, ids: ['2'] },
				AA_1: { count: 3, ids: ['3', '4', '5'] },
				AAA_1: { count: 1, ids: ['6'] },
			},
		},
		{
			description: 'optional intermediates: mixed depths across branches',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aFC1="fc1">
						<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aFCR1="fcr1" />
					</A>
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aFC2="fc2">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aSC1="sc1">
							<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="6" aFCR2="fcr2" />
						</AA_1>
					</A>
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="7" aFC3="fc3">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="8" aSC2="sc2">
							<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="9" aSC3="sc3">
								<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="10" aFCR3="fcr3" />
							</AA_1>
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
					descendant: {
						tagName: 'AAA_1',
					},
				},
			},
			expected: {
				A: { count: 3, ids: ['2', '4', '7'] },
				AA_1: { count: 3, ids: ['5', '8', '9'] },
				AAA_1: { count: 3, ids: ['3', '6', '10'] },
			},
		},
		{
			description: 'optional intermediates: required when has attributes',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="2" aFC="fc">
						<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="3" aFCR="fcr" />
					</A>
					<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="4" aFC="fc">
						<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="5" aAA_1="special">
							<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="6" aFCR="fcr" />
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
					attributes: { aAA_1: 'special' }, // Required, not optional
					descendant: {
						tagName: 'AAA_1',
					},
				},
			},
			expected: {
				A: { count: 1, ids: ['4'] }, // Only second branch matches
				AA_1: { count: 1, ids: ['5'] },
				AAA_1: { count: 1, ids: ['6'] },
			},
		},
	]

	testCases.forEach(({ description, xml, startFrom, filter, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

			try {
				const results = filter
					? await dialecte.fromElement(startFrom).findDescendants(filter)
					: await dialecte.fromElement(startFrom).findDescendants()

				// For no-filter cases, verify only expected tags (allow extra empty arrays)
				const isNoFilter = filter === undefined

				// Verify each expected tag
				for (const [tagName, expectedData] of Object.entries(expected)) {
					const tagResults = (results as any)[tagName] || []
					expect(tagResults.length, `${tagName} count mismatch`).toBe(expectedData.count)

					if (expectedData.ids) {
						const resultIds = tagResults.map((record: any) => record.id).sort()
						expect(resultIds, `${tagName} ids mismatch`).toEqual([...expectedData.ids].sort())
					}
				}

				// For filtered queries, verify no unexpected tags in result
				if (!isNoFilter) {
					const expectedTags = new Set(Object.keys(expected))
					const resultTags = new Set(Object.keys(results))
					for (const resultTag of resultTags) {
						expect(expectedTags.has(resultTag), `Unexpected tag ${resultTag} in result`).toBe(true)
					}
				}
			} finally {
				await cleanup()
			}
		})
	})
})
