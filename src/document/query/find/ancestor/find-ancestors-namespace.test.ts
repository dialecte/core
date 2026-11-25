import { TRANSPARENT_CONFIG } from '../../get/tree/get-tree.transparent.fixtures'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	createTestRunner,
} from '@/test'

import type { TransparentTestDialecteConfig } from '../../get/tree/get-tree.fixtures.types'
import type { FindAncestorsOptions } from './find-ancestor.types'
import type { ActParams, BaseXmlTestCase, TestCases } from '@/test'

const customId = CUSTOM_RECORD_ID_ATTRIBUTE
const runTransparentCases = createTestRunner<TransparentTestDialecteConfig>({
	dialecteConfig: TRANSPARENT_CONFIG,
})

/**
 * a1 holds the dialecte's AA_1, a2 an AA_1 in another namespace, each over AAA_1 > AAAA_1; a3 the dialecte's AA_1 with
 * an AA_1 in another namespace lower in the same chain.
 */
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
		<A ${customId}="a3" aA="v">
			<AA_1 ${customId}="aa3" aAA_1="v">
				<AAA_1 ${customId}="aaa3" aAAA_1="v">
					<other:AA_1 ${customId}="aa4">
						<AAAA_1 ${customId}="aaaa4" aAAAA_1="v" />
					</other:AA_1>
				</AAA_1>
			</AA_1>
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

/**
 * AA_1 by URI, not by prefix: a6 holds an AA_1 in no namespace, a7 an AA_1 in the dialecte's namespace under the
 * prefix d; each over AAA_1 > AAAA_1 in the dialecte's namespace.
 */
const uriSourceXml = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} xmlns:d="${TRANSPARENT_CONFIG.namespaces.default.uri}">
		<A ${customId}="a6" aA="v">
			<AA_1 xmlns="" ${customId}="aa7">
				<d:AAA_1 ${customId}="aaa7" aAAA_1="v">
					<d:AAAA_1 ${customId}="aaaa7" aAAAA_1="v" />
				</d:AAA_1>
			</AA_1>
		</A>
		<A ${customId}="a7" aA="v">
			<d:AA_1 ${customId}="aa8" aAA_1="v">
				<AAA_1 ${customId}="aaa8" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa8" aAAAA_1="v" />
				</AAA_1>
			</d:AA_1>
		</A>
	</Root>
`

/** An ancestor's id, `root` for the root (it carries no custom id). */
function labelOf(ancestor: { tagName: string; id: string }): string {
	return ancestor.tagName === 'Root' ? 'root' : ancestor.id
}

/** Contract: only an AA_1 in the dialecte's namespace is walked through; a same-name foreign element is an ancestor. */
describe('findAncestors - transparent only in its own namespace', () => {
	type TestCase = BaseXmlTestCase & {
		id: string
		options?: FindAncestorsOptions<TransparentTestDialecteConfig>
		expectedIds: string[]
	}

	const testCases: TestCases<TestCase> = {
		'own AA_1 → left out': {
			sourceXml,
			id: 'aaaa1',
			expectedIds: ['aaa1', 'a1', 'root'],
		},
		'foreign AA_1 → in the chain': {
			sourceXml,
			id: 'aaaa2',
			expectedIds: ['aaa2', 'aa2', 'a2', 'root'],
		},
		'foreign AA_1, depth 2 → takes a level': {
			sourceXml,
			id: 'aaaa2',
			expectedIds: ['aaa2', 'aa2'],
			options: { depth: 2 },
		},
		'own AA_1 above a foreign AA_1 → only the own one left out': {
			sourceXml,
			id: 'aaaa4',
			expectedIds: ['aa4', 'aaa3', 'a3', 'root'],
		},
		'unwrap AA_3, ext:AA_3 → left out': {
			sourceXml: extSourceXml,
			id: 'aaaa5',
			options: { unwrap: ['AA_3'] },
			expectedIds: ['aaa5', 'a4', 'root'],
		},
		'unwrap AA_3, AA_3 in the default namespace → in the chain': {
			sourceXml: extSourceXml,
			id: 'aaaa6',
			options: { unwrap: ['AA_3'] },
			expectedIds: ['aaa6', 'aa6', 'a5', 'root'],
		},
		'AA_1 in no namespace → in the chain': {
			sourceXml: uriSourceXml,
			id: 'aaaa7',
			expectedIds: ['aaa7', 'aa7', 'a6', 'root'],
		},
		"the dialecte's URI under another prefix → left out": {
			sourceXml: uriSourceXml,
			id: 'aaaa8',
			expectedIds: ['aaa8', 'a7', 'root'],
		},
		'foreign AA_1, stopAtTagName AA_1 → stops there': {
			sourceXml,
			id: 'aaaa2',
			expectedIds: ['aaa2', 'aa2'],
			options: { stopAtTagName: 'AA_1' },
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TransparentTestDialecteConfig, TestCase>): Promise<void> {
		const ancestors = await source.query.findAncestors(
			{ tagName: 'AAAA_1', id: testCase.id },
			testCase.options,
		)
		expect(ancestors.map(labelOf)).toEqual(testCase.expectedIds)
	}

	runTransparentCases.withoutExport({ testCases, act })
})

/** Contract: findAncestorsOfEach applies the same rule to each position. */
describe('findAncestorsOfEach - transparent only in its own namespace', () => {
	type TestCase = BaseXmlTestCase & { expectedIds: string[][] }

	const testCases: TestCases<TestCase> = {
		'own and foreign AA_1 → the own one left out, the foreign one kept': {
			sourceXml,
			expectedIds: [
				['aaa1', 'a1', 'root'],
				['aaa2', 'aa2', 'a2', 'root'],
			],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TransparentTestDialecteConfig, TestCase>): Promise<void> {
		const chains = await source.query.findAncestorsOfEach([
			{ tagName: 'AAAA_1', id: 'aaaa1' },
			{ tagName: 'AAAA_1', id: 'aaaa2' },
		])
		expect(chains.map((chain) => chain.map(labelOf))).toEqual(testCase.expectedIds)
	}

	runTransparentCases.withoutExport({ testCases, act })
})
