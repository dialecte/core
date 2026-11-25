import { toNamespaceShape } from '../../tree-filter/unwrap.fixtures'
import { TRANSPARENT_CONFIG } from './get-tree.transparent.fixtures'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	createTestRunner,
} from '@/test'

import type { NamespaceShape as Shape } from '../../tree-filter/unwrap.fixtures.types'
import type { TransparentTestDialecteConfig } from './get-tree.fixtures.types'
import type { GetTreeParams } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases } from '@/test'
import type { AnyTreeRecord, ElementsOf } from '@/types'

const customId = CUSTOM_RECORD_ID_ATTRIBUTE

const own = TRANSPARENT_CONFIG.namespaces.default.uri
const other = 'urn:test:other'

/** a1 holds the dialecte's AA_1, a2 an AA_1 in another namespace; each over AAA_1 > AAAA_1. */
const sourceXml = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} xmlns:other="urn:test:other">
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
				</AAA_1>
			</AA_1>
		</A>
		<A ${customId}="a2" aA="v">
			<other:AA_1 ${customId}="aa2">
				<AAA_1 ${customId}="aaa2" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa2" aAAAA_1="v" />
				</AAA_1>
			</other:AA_1>
		</A>
	</Root>
`

/** AA_3 is declared in the ext namespace: a4 holds an ext:AA_3, a5 an AA_3 in the default namespace; each over AAA_1 > AAAA_1. */
const extSourceXml = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}>
		<A ${customId}="a4" aA="v">
			<ext:AA_3 ${customId}="aa5">
				<AAA_1 ${customId}="aaa5" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa5" aAAAA_1="v" />
				</AAA_1>
			</ext:AA_3>
		</A>
		<A ${customId}="a5" aA="v">
			<AA_3 ${customId}="aa6">
				<AAA_1 ${customId}="aaa6" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa6" aAAAA_1="v" />
				</AAA_1>
			</AA_3>
		</A>
	</Root>
`

const leaf: Shape = { tagName: 'AAAA_1', uri: own, tree: [] }

/** Contract: only an AA_1 in the dialecte's namespace is hoisted; a same-name foreign element is a node. */
describe('getTree - transparent only in its own namespace', () => {
	type TestCase = BaseXmlTestCase & {
		id: string
		options?: GetTreeParams<
			TransparentTestDialecteConfig,
			ElementsOf<TransparentTestDialecteConfig>
		>
		expectedShape: Shape
	}

	const testCases: TestCases<TestCase> = {
		'own AA_1 → hoisted': {
			sourceXml,
			id: 'a1',
			expectedShape: {
				tagName: 'A',
				uri: own,
				tree: [{ tagName: 'AAA_1', uri: own, tree: [leaf] }],
			},
		},
		'own AA_1, depth 1 → takes no level': {
			sourceXml,
			id: 'a1',
			options: { depth: 1 },
			expectedShape: {
				tagName: 'A',
				uri: own,
				tree: [{ tagName: 'AAA_1', uri: own, tree: [] }],
			},
		},
		'foreign AA_1 → kept as a node': {
			sourceXml,
			id: 'a2',
			expectedShape: {
				tagName: 'A',
				uri: own,
				tree: [
					{
						tagName: 'AA_1',
						uri: other,
						tree: [{ tagName: 'AAA_1', uri: own, tree: [leaf] }],
					},
				],
			},
		},
		'foreign AA_1, depth 1 → takes a level': {
			sourceXml,
			id: 'a2',
			options: { depth: 1 },
			expectedShape: {
				tagName: 'A',
				uri: own,
				tree: [{ tagName: 'AA_1', uri: other, tree: [] }],
			},
		},
		'own AA_1, expanded a1 → the hoisted wrapper opens': {
			sourceXml,
			id: 'a1',
			options: { expanded: new Set(['a1']) },
			expectedShape: {
				tagName: 'A',
				uri: own,
				tree: [{ tagName: 'AAA_1', uri: own, tree: [] }],
			},
		},
		'foreign AA_1, expanded a2 → stays closed': {
			sourceXml,
			id: 'a2',
			options: { expanded: new Set(['a2']) },
			expectedShape: {
				tagName: 'A',
				uri: own,
				tree: [{ tagName: 'AA_1', uri: other, tree: [] }],
			},
		},
		'unwrap AA_3, ext:AA_3 → hoisted': {
			sourceXml: extSourceXml,
			id: 'a4',
			options: { unwrap: ['AA_3'] },
			expectedShape: {
				tagName: 'A',
				uri: own,
				tree: [{ tagName: 'AAA_1', uri: own, tree: [leaf] }],
			},
		},
		'unwrap AA_3, AA_3 in the default namespace → kept as a node': {
			sourceXml: extSourceXml,
			id: 'a5',
			options: { unwrap: ['AA_3'] },
			expectedShape: {
				tagName: 'A',
				uri: own,
				tree: [{ tagName: 'AA_3', uri: own, tree: [{ tagName: 'AAA_1', uri: own, tree: [leaf] }] }],
			},
		},
		'foreign AA_1, select AAA_1 → no select passed through it': {
			sourceXml,
			id: 'a2',
			options: { select: { AAA_1: true } },
			expectedShape: { tagName: 'A', uri: own, tree: [] },
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TransparentTestDialecteConfig, TestCase>): Promise<void> {
		const tree = await source.query.getTree({ tagName: 'A', id: testCase.id }, testCase.options)
		expect(toNamespaceShape(tree as AnyTreeRecord)).toEqual(testCase.expectedShape)
	}

	createTestRunner<TransparentTestDialecteConfig>({
		dialecteConfig: TRANSPARENT_CONFIG,
	}).withoutExport({ testCases, act })
})
