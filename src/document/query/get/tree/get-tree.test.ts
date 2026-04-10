import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runXmlTestCases } from '@/test'

import type { GetTreeParams } from '@/document'
import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { AnyTreeRecord, ElementsOf, Ref } from '@/types'

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
		'returns leaf node with empty tree': {
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
			expectedShape: {
				tagName: 'A',
				tree: [
					{ tagName: 'AA_1', tree: [] },
					{ tagName: 'AA_2', tree: [] },
				],
			},
		},
		'returns full recursive tree': {
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
		'include filter: only matching tagName is returned': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v" />
						<AA_2 ${customId}="aa2" aAA_2="v" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { include: { tagName: 'AA_1' } },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [] }],
			},
		},
		'include filter with attributes: only matching attribute value': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="match" />
						<AA_1 ${customId}="aa2" aAA_1="no-match" />
					</A>
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			options: { include: { tagName: 'AA_1', attributes: { aAA_1: 'match' } } },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [] }],
			},
		},
		'include filter nested: grandchildren filtered by children config': {
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
			options: { include: { tagName: 'AA_1', children: [{ tagName: 'AAA_1' }] } },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [{ tagName: 'AAA_1', tree: [] }] }],
			},
		},
		'exclude filter (scope: self): removes node and its subtree': {
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
			options: { exclude: [{ tagName: 'AA_1', scope: 'self' }] },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_2', tree: [] }],
			},
		},
		'exclude filter (scope: children): keeps node but stops traversal': {
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
			options: { exclude: [{ tagName: 'AA_1', scope: 'children' }] },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_1', tree: [] }],
			},
		},
		'unwrap: removes intermediate layer and promotes grandchildren': {
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
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.document.query.getTree(testCase.ref, testCase.options)
		expect(result).toBeDefined()
		expect(toShape(result as AnyTreeRecord)).toEqual(testCase.expectedShape)
	}

	runXmlTestCases({ testCases, act })
})
