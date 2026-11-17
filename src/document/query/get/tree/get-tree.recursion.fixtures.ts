import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, TEST_DIALECTE_CONFIG } from '@/test'

import type { GetTreeCase, RecursiveTestDialecteConfig } from './get-tree.fixtures.types'
import type { TestCases } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

// Config with self-recursive element: AAA_1 can contain AAA_1
export const RECURSIVE_CONFIG = {
	...TEST_DIALECTE_CONFIG,
	children: {
		...TEST_DIALECTE_CONFIG.children,
		AAA_1: [...TEST_DIALECTE_CONFIG.children.AAA_1, 'AAA_1'],
	},
} as unknown as RecursiveTestDialecteConfig

/** The cases on a dialecte where AAA_1 contains AAA_1: auto-recursion and `recursive`. */
export const AUTO_RECURSION_CASES: TestCases<GetTreeCase<RecursiveTestDialecteConfig>> = {
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
							// config order for AAA_1 children: AAAA_1… before the self-recursive AAA_1
							tree: [
								{ tagName: 'AAAA_1', tree: [] },
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
