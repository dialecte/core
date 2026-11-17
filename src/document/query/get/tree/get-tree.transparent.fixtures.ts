import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, TEST_DIALECTE_CONFIG } from '@/test'

import type { GetTreeCase, TransparentTestDialecteConfig } from './get-tree.fixtures.types'
import type { TestCases } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

// Config with transparent element: AA_1 is transparent
export const TRANSPARENT_CONFIG = {
	...TEST_DIALECTE_CONFIG,
	transparentElements: ['AA_1'] as const,
} as unknown as TransparentTestDialecteConfig

/** The cases on a dialecte where AA_1 is transparent: select and unwrap see through it. */
export const TRANSPARENT_CASES: TestCases<GetTreeCase<TransparentTestDialecteConfig>> = {
	'select looks through transparent element to find children': {
		sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="wrapper">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
							<AAA_2 ${customId}="aaa2" aAAA_2="v" />
						</AA_1>
					</A>
				</Root>
			`,
		ref: { tagName: 'A', id: 'a1' },
		options: { select: { AAA_1: true } },
		expectedShape: {
			tagName: 'A',
			tree: [{ tagName: 'AAA_1', tree: [] }],
		},
	},
	'transparent element is auto-unwrapped from result': {
		sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="wrapper">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
						<AA_2 ${customId}="aa2" aAA_2="v" />
					</A>
				</Root>
			`,
		ref: { tagName: 'A', id: 'a1' },
		expectedShape: {
			tagName: 'A',
			// config order: AA_2 is a declared child of A, the promoted AAA_1 is not → last
			tree: [
				{ tagName: 'AA_2', tree: [] },
				{ tagName: 'AAA_1', tree: [] },
			],
		},
	},
	'nested select passes through transparent element': {
		sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="wrapper">
							<AAA_1 ${customId}="aaa1" aAAA_1="v">
								<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
							</AAA_1>
						</AA_1>
					</A>
				</Root>
			`,
		ref: { tagName: 'A', id: 'a1' },
		options: { select: { AAA_1: { AAAA_1: true } } },
		expectedShape: {
			tagName: 'A',
			tree: [{ tagName: 'AAA_1', tree: [{ tagName: 'AAAA_1', tree: [] }] }],
		},
	},
	'explicit unwrap overrides auto-unwrap': {
		sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="wrapper">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
					</A>
				</Root>
			`,
		ref: { tagName: 'A', id: 'a1' },
		options: { unwrap: [] },
		expectedShape: {
			tagName: 'A',
			tree: [{ tagName: 'AA_1', tree: [{ tagName: 'AAA_1', tree: [] }] }],
		},
	},
	'explicit transparent element in select - backward compatible': {
		sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="wrapper">
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
			tree: [{ tagName: 'AAA_1', tree: [] }],
		},
	},
}
