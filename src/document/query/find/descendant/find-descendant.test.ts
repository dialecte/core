import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { Collect, FindDescendantsParams } from './find-descendant.types'
import type { Ref } from '@/document'
import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('findDescendants - collect string', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		options: FindDescendantsParams<
			TestDialecteConfig,
			ElementsOf<TestDialecteConfig>,
			Collect<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		>
		expectedCounts: Partial<Record<ElementsOf<TestDialecteConfig>, number>>
	}

	const testCases: Record<string, TestCase> = {
		'single tagName - finds all at any depth': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
						<AA_1 ${customId}="aa2" aAA_1="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AA_1' },
			expectedCounts: { AA_1: 2 },
		},
		'single tagName - deep nesting': {
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
			options: { collect: 'AAAA_1' },
			expectedCounts: { AAAA_1: 1 },
		},
		'single tagName - returns empty when none found': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AA_2' },
			expectedCounts: { AA_2: 0 },
		},
		'single tagName - does not include results from sibling subtrees': {
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
			options: { collect: 'AA_1' },
			expectedCounts: { AA_1: 1 },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.findDescendants(testCase.ref, testCase.options)
		for (const [tagName, count] of Object.entries(testCase.expectedCounts)) {
			expect(
				(result as Record<string, unknown[]>)[tagName] ?? [],
				`expected ${tagName} count`,
			).toHaveLength(count)
		}
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('findDescendants - collect array', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		options: FindDescendantsParams<
			TestDialecteConfig,
			ElementsOf<TestDialecteConfig>,
			Collect<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		>
		expectedCounts: Partial<Record<ElementsOf<TestDialecteConfig>, number>>
	}

	const testCases: Record<string, TestCase> = {
		'multiple tagNames collected': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
						<AA_2 ${customId}="aa2" aAA_2="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: ['AA_1', 'AA_2'] },
			expectedCounts: { AA_1: 1, AA_2: 1 },
		},
		'array with where filter on entry': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="match" />
						<AA_1 ${customId}="aa2" aAA_1="no-match" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: [{ AA_1: { where: { aAA_1: 'match' } } }] },
			expectedCounts: { AA_1: 1 },
		},
		'array mixing strings and objects': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="match" />
						<AA_1 ${customId}="aa2" aAA_1="no" />
						<AA_2 ${customId}="aa3" aAA_2="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: [{ AA_1: { where: { aAA_1: 'match' } } }, 'AA_2'] },
			expectedCounts: { AA_1: 1, AA_2: 1 },
		},
		'where with array values - OR logic': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="alpha" />
						<AA_1 ${customId}="aa2" aAA_1="beta" />
						<AA_1 ${customId}="aa3" aAA_1="gamma" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: [{ AA_1: { where: { aAA_1: ['alpha', 'beta'] } } }] },
			expectedCounts: { AA_1: 2 },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.findDescendants(testCase.ref, testCase.options)
		for (const [tagName, count] of Object.entries(testCase.expectedCounts)) {
			expect(
				(result as Record<string, unknown[]>)[tagName] ?? [],
				`expected ${tagName} count`,
			).toHaveLength(count)
		}
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('findDescendants - collect path (object)', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		options: FindDescendantsParams<
			TestDialecteConfig,
			ElementsOf<TestDialecteConfig>,
			Collect<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		>
		expectedCounts: Partial<Record<ElementsOf<TestDialecteConfig>, number>>
	}

	const testCases: Record<string, TestCase> = {
		'path-aware - collects only descendants through path': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
						<AA_2 ${customId}="aa2" aAA_2="v">
							<AAA_1 ${customId}="aaa2" aAAA_1="v" />
						</AA_2>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: { AA_1: { AAA_1: true } } },
			expectedCounts: { AA_1: 1, AAA_1: 1 },
		},
		'path-aware - collects intermediate nodes': {
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
			options: { collect: { AA_1: { AAA_1: { AAAA_1: true } } } },
			expectedCounts: { AA_1: 1, AAA_1: 1, AAAA_1: 1 },
		},
		'path-aware with where filter': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="match">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
						<AA_1 ${customId}="aa2" aAA_1="no-match">
							<AAA_1 ${customId}="aaa2" aAAA_1="v" />
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: { AA_1: { where: { aAA_1: 'match' }, AAA_1: true } } },
			expectedCounts: { AA_1: 1, AAA_1: 1 },
		},
		'path with multiple sibling targets at same level': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
						<AA_2 ${customId}="aa2" aAA_2="v">
							<AAA_2 ${customId}="aaa2" aAAA_2="v" />
						</AA_2>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: { AA_1: true, AA_2: true } },
			expectedCounts: { AA_1: 1, AA_2: 1 },
		},
		'path where intermediate has no matching children - returns empty': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: { AA_1: { AAA_1: true } } },
			expectedCounts: { AA_1: 1, AAA_1: 0 },
		},
		'non-existent ref - returns empty results': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'non-existent' },
			options: { collect: { AA_1: true } },
			expectedCounts: { AA_1: 0 },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.findDescendants(testCase.ref, testCase.options)
		for (const [tagName, count] of Object.entries(testCase.expectedCounts)) {
			expect(
				(result as Record<string, unknown[]>)[tagName] ?? [],
				`expected ${tagName} count`,
			).toHaveLength(count)
		}
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('findDescendants - omit', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		options: FindDescendantsParams<
			TestDialecteConfig,
			ElementsOf<TestDialecteConfig>,
			Collect<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		>
		expectedCounts: Partial<Record<ElementsOf<TestDialecteConfig>, number>>
	}

	const testCases: Record<string, TestCase> = {
		'omit skips entire subtree': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
						<AA_2 ${customId}="aa2" aAA_2="v">
							<AAA_1 ${customId}="aaa2" aAAA_1="v" />
						</AA_2>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AAA_1', omit: ['AA_1'] },
			expectedCounts: { AAA_1: 1 },
		},
		'omit does not affect unrelated branches': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
						<AA_2 ${customId}="aa2" aAA_2="v" />
						<AA_3 ${customId}="aa3" aAA_3="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: ['AA_1', 'AA_2', 'AA_3'], omit: ['AA_3'] },
			expectedCounts: { AA_1: 1, AA_2: 1, AA_3: 0 },
		},
		'omit in path mode - excludes subtree from path traversal': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
						<AA_2 ${customId}="aa2" aAA_2="v">
							<AAA_1 ${customId}="aaa2" aAAA_1="v" />
						</AA_2>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: { AA_1: { AAA_1: true } }, omit: ['AA_1'] },
			expectedCounts: { AA_1: 0, AAA_1: 0 },
		},
		'omit with where - conditional exclusion': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="skip" />
						<AA_1 ${customId}="aa2" aAA_1="keep" />
						<AA_2 ${customId}="aa3" aAA_2="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: {
				collect: ['AA_1', 'AA_2'],
				omit: [{ AA_1: { where: { aAA_1: 'skip' } } }],
			},
			expectedCounts: { AA_1: 1, AA_2: 1 },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.findDescendants(testCase.ref, testCase.options)
		for (const [tagName, count] of Object.entries(testCase.expectedCounts)) {
			expect(
				(result as Record<string, unknown[]>)[tagName] ?? [],
				`expected ${tagName} count`,
			).toHaveLength(count)
		}
	}

	runTestCases.withoutExport({ testCases, act })
})
