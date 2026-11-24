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

import type { FindAncestorsOptions } from './find-ancestor.types'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** The test dialecte with AA_1 a transparent element. */
const TRANSPARENT_DIALECTE = defineDialecte({
	id: 'core/test-transparent-ancestors',
	version: '0.0.0',
	configs: {
		[TEST_CONFIG_KEY]: { ...TEST_DIALECTE_CONFIG, transparentElements: ['AA_1'] as const },
	},
	defaultConfigKey: TEST_CONFIG_KEY,
})
const runTransparentCases = createTestRunner({ dialecte: TRANSPARENT_DIALECTE })

/** Root > A > AA_1 (transparent) > AAA_1 > AAAA_1, and A > AA_2 > AAA_3 beside it. */
const chainXml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
				</AAA_1>
			</AA_1>
			<AA_2 ${customId}="aa2" aAA_2="v">
				<AAA_3 ${customId}="aaa3" aAAA_3="v" />
			</AA_2>
		</A>
	</Root>
`

/** Contract: the ancestor reads go through the dialecte's transparent elements unless `unwrap` says otherwise. */
describe('findAncestors - through transparent elements', () => {
	type TestCase = BaseXmlTestCase & {
		options?: FindAncestorsOptions<TestDialecteConfig>
		expectedTagNames: string[]
	}

	const testCases: TestCases<TestCase> = {
		'no option → the transparent AA_1 left out': {
			sourceXml: chainXml,
			expectedTagNames: ['AAA_1', 'A', 'Root'],
		},
		'depth 2 → AA_1 takes no level': {
			sourceXml: chainXml,
			options: { depth: 2 },
			expectedTagNames: ['AAA_1', 'A'],
		},
		'stopAtTagName AA_1, a transparent element → never matched, the walk goes to the root': {
			sourceXml: chainXml,
			options: { stopAtTagName: 'AA_1' },
			expectedTagNames: ['AAA_1', 'A', 'Root'],
		},
		'unwrap [] → every stored ancestor, AA_1 included': {
			sourceXml: chainXml,
			options: { unwrap: [] },
			expectedTagNames: ['AAA_1', 'AA_1', 'A', 'Root'],
		},
		'unwrap [AAA_1] → replaces the default: AA_1 answered, AAA_1 left out': {
			sourceXml: chainXml,
			options: { unwrap: ['AAA_1'] },
			expectedTagNames: ['AA_1', 'A', 'Root'],
		},
		'top-down → the same chain, root first': {
			sourceXml: chainXml,
			options: { order: 'top-down' },
			expectedTagNames: ['Root', 'A', 'AAA_1'],
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const ancestors = await source.query.findAncestors(
			{ tagName: 'AAAA_1', id: 'aaaa1' },
			testCase.options,
		)
		expect(ancestors.map((ancestor) => ancestor.tagName)).toEqual(testCase.expectedTagNames)
	}

	runTransparentCases.withoutExport({ testCases, act: act as never })
})

/** Contract: `findAncestorsOfEach` applies the same rule to each input position. */
describe('findAncestorsOfEach - through transparent elements', () => {
	type TestCase = BaseXmlTestCase & { expectedTagNames: string[][] }

	const testCases: TestCases<TestCase> = {
		'one element under the transparent AA_1, one under AA_2 → AA_1 left out of the first only': {
			sourceXml: chainXml,
			expectedTagNames: [
				['AAA_1', 'A', 'Root'],
				['AA_2', 'A', 'Root'],
			],
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const ancestries = await source.query.findAncestorsOfEach([
			{ tagName: 'AAAA_1', id: 'aaaa1' },
			{ tagName: 'AAA_3', id: 'aaa3' },
		])
		expect(ancestries.map((chain) => chain.map((ancestor) => ancestor.tagName))).toEqual(
			testCase.expectedTagNames,
		)
	}

	runTransparentCases.withoutExport({ testCases, act: act as never })
})
