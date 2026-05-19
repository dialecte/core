import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	runTestCases,
	TEST_DIALECTE_CONFIG,
	createTestRunner,
} from '@/test'

import type { GetTreeParams } from '@/document'
import type { Ref } from '@/document'
import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { AnyTreeRecord, ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

type TreeShape = { tagName: string; tree: TreeShape[] }

function toShape(record: AnyTreeRecord): TreeShape {
	return {
		tagName: record.tagName,
		tree: record.tree.map((child) => toShape(child as AnyTreeRecord)),
	}
}

describe('getTree', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		options?: GetTreeParams<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expectedShape: TreeShape
	}

	const testCases: Record<string, TestCase> = {
		'no options - returns full recursive tree': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [{ tagName: 'AAA_1', tree: [] }] }],
			},
		},
		'no options - returns leaf node with empty tree': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'AA_1', id: 'aa1' },
			expectedShape: { tagName: 'AA_1', tree: [] },
		},
		'select - only matching tagName children included': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
						<AA_2 ${customId}="aa2" aAA_2="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { select: { AA_1: true } },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [] }],
			},
		},
		'select - nested projection narrows at each level': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
							<AAA_2 ${customId}="aaa2" aAAA_2="v" />
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { select: { AA_1: { AAA_1: true } } },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [{ tagName: 'AAA_1', tree: [] }] }],
			},
		},
		'select - true includes all descendants below': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v">
								<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
							</AAA_1>
							<AAA_2 ${customId}="aaa2" aAAA_2="v" />
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { select: { AA_1: true } },
			expectedShape: {
				tagName: 'A',
				tree: [
					{
						tagName: 'AA_1',
						tree: [
							{ tagName: 'AAA_1', tree: [{ tagName: 'AAAA_1', tree: [] }] },
							{ tagName: 'AAA_2', tree: [] },
						],
					},
				],
			},
		},
		'select - false excludes matching child': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
						<AA_2 ${customId}="aa2" aAA_2="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { select: { AA_1: true, AA_2: false } },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [] }],
			},
		},
		'select with where - attribute filter on parent level': {
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
			options: { select: { AA_1: { where: { aAA_1: 'match' }, AAA_1: true } } },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [{ tagName: 'AAA_1', tree: [] }] }],
			},
		},
		'select recursive - self-referencing children re-apply filter': {
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
			options: {
				select: {
					AA_1: {
						AAA_1: {
							recursive: true,
							AAAA_1: true,
						},
					},
				},
			},
			expectedShape: {
				tagName: 'A',
				tree: [
					{
						tagName: 'AA_1',
						tree: [{ tagName: 'AAA_1', tree: [{ tagName: 'AAAA_1', tree: [] }] }],
					},
				],
			},
		},
		'omit string - removes element and subtree globally': {
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
			options: { omit: ['AA_1'] },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_2', tree: [] }],
			},
		},
		'omit with where - conditional exclusion': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="exclude-me" />
						<AA_1 ${customId}="aa2" aAA_1="keep-me" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: {
				omit: [{ AA_1: { where: { aAA_1: 'exclude-me' } } }],
			},
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [] }],
			},
		},
		'omit scope children - keeps node but stops traversal': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: {
				omit: [{ AA_1: { where: { aAA_1: 'v' }, scope: 'children' } }],
			},
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [] }],
			},
		},
		'unwrap - removes intermediate layer and promotes grandchildren': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { unwrap: ['AA_1'] },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AAA_1', tree: [] }],
			},
		},
		'select + omit combined - select narrows, omit excludes globally': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
							<AAA_2 ${customId}="aaa2" aAAA_2="v" />
						</AA_1>
						<AA_2 ${customId}="aa2" aAA_2="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: {
				select: { AA_1: true },
				omit: ['AAA_2'],
			},
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [{ tagName: 'AAA_1', tree: [] }] }],
			},
		},
		'unwrap + select combined - unwrap applies after select filtering': {
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
			options: {
				select: { AA_1: true },
				unwrap: ['AA_1'],
			},
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AAA_1', tree: [] }],
			},
		},
		'unwrap tag not in tree - no-op': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { unwrap: ['AA_2'] },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [] }],
			},
		},
		'omit all children - returns node with empty tree': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
						<AA_2 ${customId}="aa2" aAA_2="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { omit: ['AA_1', 'AA_2'] },
			expectedShape: {
				tagName: 'A',
				tree: [],
			},
		},
		'select nested path - stops traversal beyond selected scope': {
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
			options: { select: { AA_1: { AAA_1: true } } },
			expectedShape: {
				tagName: 'A',
				tree: [
					{
						tagName: 'AA_1',
						tree: [{ tagName: 'AAA_1', tree: [{ tagName: 'AAAA_1', tree: [] }] }],
					},
				],
			},
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.getTree(testCase.ref, testCase.options)
		expect(result).toBeDefined()
		expect(toShape(result as AnyTreeRecord)).toEqual(testCase.expectedShape)
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('getTree - error handling', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		options?: GetTreeParams<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
	}

	const testCases: Record<string, TestCase> = {
		'non-existent ref - throws ELEMENT_NOT_FOUND': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'non-existent' },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		await expect(source.query.getTree(testCase.ref, testCase.options)).rejects.toThrow()
	}

	runTestCases.withoutExport({ testCases, act })
})

//== Auto-recursion tests

// Config with self-recursive element: AAA_1 can contain AAA_1
type RecursiveTestDialecteConfig = Omit<TestDialecteConfig, 'children'> & {
	readonly children: Omit<TestDialecteConfig['children'], 'AAA_1'> & {
		readonly AAA_1: readonly ['AAAA_1', 'AAAA_2', 'AAAA_3', 'AAA_1']
	}
}

const RECURSIVE_CONFIG = {
	...TEST_DIALECTE_CONFIG,
	children: {
		...TEST_DIALECTE_CONFIG.children,
		AAA_1: [...TEST_DIALECTE_CONFIG.children.AAA_1, 'AAA_1'],
	},
} as unknown as RecursiveTestDialecteConfig

const recursiveRunner = createTestRunner({ dialecteConfig: RECURSIVE_CONFIG })

describe('getTree - auto-recursion', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<RecursiveTestDialecteConfig, ElementsOf<RecursiveTestDialecteConfig>>
		options?: GetTreeParams<RecursiveTestDialecteConfig, ElementsOf<RecursiveTestDialecteConfig>>
		expectedShape: TreeShape
	}

	const testCases: Record<string, TestCase> = {
		'self-recursive element - auto-recurses without explicit recursive flag': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v">
								<AAA_1 ${customId}="aaa2" aAAA_1="v">
									<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
								</AAA_1>
								<AAAA_1 ${customId}="aaaa2" aAAAA_1="v" />
							</AAA_1>
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { select: { AA_1: { AAA_1: { AAAA_1: true } } } },
			expectedShape: {
				tagName: 'A',
				tree: [
					{
						tagName: 'AA_1',
						tree: [
							{
								tagName: 'AAA_1',
								tree: [
									{
										tagName: 'AAA_1',
										tree: [{ tagName: 'AAAA_1', tree: [] }],
									},
									{ tagName: 'AAAA_1', tree: [] },
								],
							},
						],
					},
				],
			},
		},
		'self-recursive element with where - filter applied at every depth': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="keep">
								<AAA_1 ${customId}="aaa2" aAAA_1="skip">
									<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
								</AAA_1>
								<AAA_1 ${customId}="aaa3" aAAA_1="keep">
									<AAAA_1 ${customId}="aaaa2" aAAAA_1="v" />
								</AAA_1>
							</AAA_1>
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: {
				select: { AA_1: { AAA_1: { where: { aAAA_1: 'keep' }, AAAA_1: true } } },
			},
			expectedShape: {
				tagName: 'A',
				tree: [
					{
						tagName: 'AA_1',
						tree: [
							{
								tagName: 'AAA_1',
								tree: [
									{
										tagName: 'AAA_1',
										tree: [{ tagName: 'AAAA_1', tree: [] }],
									},
								],
							},
						],
					},
				],
			},
		},
		'self-recursive element with explicit self-key - respects explicit structure': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v">
								<AAA_1 ${customId}="aaa2" aAAA_1="target">
									<AAA_1 ${customId}="aaa3" aAAA_1="v">
										<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
									</AAA_1>
									<AAAA_1 ${customId}="aaaa2" aAAAA_1="v" />
								</AAA_1>
								<AAA_1 ${customId}="aaa4" aAAA_1="other">
									<AAAA_1 ${customId}="aaaa3" aAAAA_1="v" />
								</AAA_1>
							</AAA_1>
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: {
				select: {
					AA_1: {
						AAA_1: {
							AAA_1: { where: { aAAA_1: 'target' }, AAAA_1: true },
							AAAA_1: true,
						},
					},
				},
			},
			expectedShape: {
				tagName: 'A',
				tree: [
					{
						tagName: 'AA_1',
						tree: [
							{
								tagName: 'AAA_1',
								tree: [
									{
										tagName: 'AAA_1',
										tree: [{ tagName: 'AAAA_1', tree: [] }],
									},
								],
							},
						],
					},
				],
			},
		},
		'self-recursive with recursive false - disables auto-recursion': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v">
								<AAA_1 ${customId}="aaa2" aAAA_1="v">
									<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
								</AAA_1>
								<AAAA_1 ${customId}="aaaa2" aAAAA_1="v" />
							</AAA_1>
						</AA_1>
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: {
				select: { AA_1: { AAA_1: { recursive: false, AAAA_1: true } } },
			},
			expectedShape: {
				tagName: 'A',
				tree: [
					{
						tagName: 'AA_1',
						tree: [{ tagName: 'AAA_1', tree: [{ tagName: 'AAAA_1', tree: [] }] }],
					},
				],
			},
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<RecursiveTestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.getTree(testCase.ref, testCase.options)
		expect(result).toBeDefined()
		expect(toShape(result as AnyTreeRecord)).toEqual(testCase.expectedShape)
	}

	recursiveRunner.withoutExport({ testCases, act })
})
