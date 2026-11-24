import { describe, expect } from 'vitest'

import { defineDialecte } from '@/dialecte'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	TEST_CONFIG_KEY,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRunner,
} from '@/test'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { AnyTreeRecord } from '@/types'

const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** The test dialecte with AA_1 a transparent element. */
const TRANSPARENT_DIALECTE = defineDialecte({
	id: 'core/test-transparent-snapshot-namespace',
	version: '0.0.0',
	configs: {
		[TEST_CONFIG_KEY]: { ...TEST_DIALECTE_CONFIG, transparentElements: ['AA_1'] as const },
	},
	defaultConfigKey: TEST_CONFIG_KEY,
})
const runTransparentCases = createTestRunner({ dialecte: TRANSPARENT_DIALECTE })

type Shape = { tagName: string; uri: string; tree: Shape[] }

/** A tree node's tag, namespace URI and children. */
function toShape(record: AnyTreeRecord): Shape {
	return {
		tagName: record.tagName,
		uri: record.namespace.uri,
		tree: record.tree.map((child) => toShape(child as AnyTreeRecord)),
	}
}

const own = TEST_DIALECTE_CONFIG.namespaces.default.uri
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

const leaf: Shape = { tagName: 'AAAA_1', uri: own, tree: [] }

/** Contract: the snapshot's tree hoists only an AA_1 in the dialecte's namespace; a same-name foreign one is a node. */
describe('getSnapshot - transparent only in its own namespace', () => {
	type TestCase = BaseXmlTestCase & { id: string; expectedShape: Shape }

	const testCases: TestCases<TestCase> = {
		'own AA_1 → hoisted': {
			sourceXml,
			id: 'aaaa1',
			expectedShape: {
				tagName: 'A',
				uri: own,
				tree: [{ tagName: 'AAA_1', uri: own, tree: [leaf] }],
			},
		},
		'foreign AA_1 → kept as a node': {
			sourceXml,
			id: 'aaaa2',
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
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const tree = await source.query.getSnapshot({
			ref: { tagName: 'AAAA_1', id: testCase.id },
			ancestors: 3,
		})
		expect(toShape(tree as AnyTreeRecord)).toEqual(testCase.expectedShape)
	}

	runTransparentCases.withoutExport({ testCases, act: act as never })
})
