import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, XMLNS_EXT_NAMESPACE } from '@/test'

import type { GetTreeCase, TreeShape } from './get-tree.fixtures.types'
import type { TestCases, TestDialecteConfig } from '@/test'
import type { AnyTreeRecord } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** The tag names of a tree, nested as the tree is. */
export function toShape(record: AnyTreeRecord): TreeShape {
	return {
		tagName: record.tagName,
		tree: record.tree.map((child) => toShape(child as AnyTreeRecord)),
	}
}

/** The cases on the test dialecte: no options, select, omit, unwrap. */
export const GET_TREE_CASES: TestCases<GetTreeCase<TestDialecteConfig>> = {
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
	'no options - children returned in config order': {
		sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_2 ${customId}="aa2" aAA_2="v" />
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`,
		ref: { tagName: 'A', id: 'a1' },
		// source order is AA_2, AA_1; config A → [AA_1, AA_2, AA_3]
		expectedShape: {
			tagName: 'A',
			tree: [
				{ tagName: 'AA_1', tree: [] },
				{ tagName: 'AA_2', tree: [] },
			],
		},
	},
	'no options - a child the leading wildcard admits first, before the declared children': {
		sourceXml: /* xml */ `
				<Root ${ns} ${XMLNS_EXT_NAMESPACE}>
					<C aC="v">
						<CC_2 ${customId}="cc2" aCC_2="v">
							<CCC_1 aCCC_1="v" />
							<ext:CCCC_3 ext:aCCCC_3="v" />
						</CC_2>
					</C>
				</Root>
			`,
		ref: { tagName: 'CC_2', id: 'cc2' },
		// CC_2 → (any ##other, CCC_1, CCC_2, ext:CCC_3); ext:CCCC_3 is not declared, the wildcard admits it
		expectedShape: {
			tagName: 'CC_2',
			tree: [
				{ tagName: 'CCCC_3', tree: [] },
				{ tagName: 'CCC_1', tree: [] },
			],
		},
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
