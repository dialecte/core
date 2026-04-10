import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runXmlTestCases } from '@/test'

import type { DescendantsFilter } from '@/document'
import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { ElementsOf, Ref } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('findDescendants – no filter', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expectedCounts: Partial<Record<ElementsOf<TestDialecteConfig>, number>>
	}

	const testCases: Record<string, TestCase> = {
		'returns empty result for a leaf node': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'AA_1', id: 'aa1' },
			expectedCounts: { AAA_1: 0, AAA_2: 0, AAA_3: 0 },
		},
		'returns direct children': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="first" />
						<AA_2 ${customId}="aa2" aAA_2="second" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expectedCounts: { AA_1: 1, AA_2: 1, AA_3: 0 },
		},
		'returns all descendants at every depth': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v">
								<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
							</AAA_1>
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expectedCounts: { AA_1: 1, AAA_1: 1, AAAA_1: 1 },
		},
		'does not include descendants of sibling elements': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
					<A ${customId}="a2" aA="other">
						<AA_1 ${customId}="aa2" aAA_1="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expectedCounts: { AA_1: 1 },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.document.query.findDescendants(testCase.ref)
		for (const [tagName, count] of Object.entries(testCase.expectedCounts)) {
			expect(
				(result as Record<string, unknown[]>)[tagName] ?? [],
				`expected ${tagName} count`,
			).toHaveLength(count)
		}
	}

	runXmlTestCases({ testCases, act })
})

describe('findDescendants – with filter', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		filter: DescendantsFilter<TestDialecteConfig>
		expectedCounts: Partial<Record<ElementsOf<TestDialecteConfig>, number>>
	}

	const testCases: Record<string, TestCase> = {
		'filters descendants by tagName': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
						<AA_2 ${customId}="aa2" aAA_2="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			filter: { tagName: 'AA_1' },
			expectedCounts: { AA_1: 1 },
		},
		'filters descendants by tagName and attribute': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="match" />
						<AA_1 ${customId}="aa2" aAA_1="no-match" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			filter: { tagName: 'AA_1', attributes: { aAA_1: 'match' } },
			expectedCounts: { AA_1: 1 },
		},
		'returns empty when filter matches nothing': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			filter: { tagName: 'AA_2' },
			expectedCounts: { AA_2: 0 },
		},
		'requires tagName match by default (no isOptional)': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="deep" />
						</AA_1>
						<AA_2 ${customId}="aa2" aAA_2="v">
							<AAA_1 ${customId}="aaa2" aAAA_1="deep" />
						</AA_2>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			// AA_1 is required — only aaa1's path passes; aaa2 has no AA_1 ancestor
			filter: { tagName: 'AA_1', descendant: { tagName: 'AAA_1' } },
			expectedCounts: { AA_1: 1, AAA_1: 1 },
		},
		'isOptional: true collects when present but does not exclude absent paths': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="deep" />
						</AA_1>
						<AA_2 ${customId}="aa2" aAA_2="v">
							<AAA_1 ${customId}="aaa2" aAAA_1="deep" />
						</AA_2>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			// AA_1 is optional — both AAA_1 records pass; only aaa1's path contributes to AA_1
			filter: { tagName: 'AA_1', isOptional: true, descendant: { tagName: 'AAA_1' } },
			expectedCounts: { AA_1: 1, AAA_1: 2 },
		},
		'attribute filter on ancestor makes it a required condition': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="required">
							<AAA_1 ${customId}="aaa1" aAAA_1="deep" />
						</AA_1>
						<AA_2 ${customId}="aa2" aAA_2="v">
							<AAA_1 ${customId}="aaa2" aAAA_1="deep" />
						</AA_2>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			// AA_1 with attribute filter → required condition; only aaa1's path has matching AA_1
			filter: {
				tagName: 'AA_1',
				attributes: { aAA_1: 'required' },
				descendant: { tagName: 'AAA_1' },
			},
			expectedCounts: { AA_1: 1, AAA_1: 1 },
		},
		'does not include results outside the ref subtree': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="target">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
					<A ${customId}="a2" aA="other">
						<AA_1 ${customId}="aa2" aAA_1="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			filter: { tagName: 'AA_1' },
			expectedCounts: { AA_1: 1 },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.document.query.findDescendants(testCase.ref, testCase.filter)
		for (const [tagName, count] of Object.entries(testCase.expectedCounts)) {
			expect(
				(result as Record<string, unknown[]>)[tagName] ?? [],
				`expected ${tagName} count`,
			).toHaveLength(count)
		}
	}

	runXmlTestCases({ testCases, act })
})
