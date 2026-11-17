import { describe, expect } from 'vitest'

import { defineDialecte } from '@/dialecte'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	TEST_CONFIG_KEY,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRunner,
	runTestCases,
} from '@/test'

import type { Query } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** The test dialecte with BB_1 a transparent element (a wrapper whose content the definition does not list). */
const TRANSPARENT_DIALECTE = defineDialecte({
	id: 'core/test-transparent',
	version: '0.0.0',
	configs: {
		[TEST_CONFIG_KEY]: { ...TEST_DIALECTE_CONFIG, transparentElements: ['BB_1'] as const },
	},
	defaultConfigKey: TEST_CONFIG_KEY,
})
const runTransparentCases = createTestRunner({ dialecte: TRANSPARENT_DIALECTE })

type TestCase = BaseXmlTestCase & {
	inputs: { tagName: string; id: string }[]
	collect: string
	expected: string[][]
}

async function idsOf(params: {
	query: Query<TestDialecteConfig>
	testCase: TestCase
}): Promise<string[][]> {
	const { query, testCase } = params
	const results = (await query.findDescendantsOfEach(
		testCase.inputs as never,
		{ collect: testCase.collect } as never,
	)) as Record<string, { id: string }[]>[]
	return results.map((groups) => (groups[testCase.collect] ?? []).map(({ id }) => id))
}

async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
	await expect(idsOf({ query: source.query, testCase })).resolves.toEqual(testCase.expected)
}

/**
 * Content the definition does not list under a tag - an xs:any child, an element it does not know, the content
 * of a transparent element - can hold a collected tag: the walk follows it, as the ancestor climb found it.
 */
describe('findDescendantsOfEach - content the definition does not list', () => {
	describe('the test dialecte', () => {
		const testCases: TestCases<TestCase> = {
			'a collected tag inside an xs:any child → found': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<C ${customId}="c1" aC="v">
							<CC_2 ${customId}="cc2" aCC_2="v">
								<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
							</CC_2>
						</C>
					</Root>
				`,
				inputs: [{ tagName: 'C', id: 'c1' }],
				collect: 'AAAA_1',
				expected: [['aaaa1']],
			},
			'a collected tag under an any-content element two levels down → found': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<D ${customId}="d1">
							<DD_2 ${customId}="dd2">
								<DDD_2 ${customId}="ddd2">
									<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
								</DDD_2>
							</DD_2>
						</D>
					</Root>
				`,
				inputs: [{ tagName: 'D', id: 'd1' }],
				collect: 'AAAA_1',
				expected: [['aaaa1']],
			},
			'a collected tag under an element the definition does not know → found': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<C ${customId}="c1" aC="v">
							<CC_2 ${customId}="cc2" aCC_2="v">
								<Unlisted ${customId}="unlisted1">
									<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
								</Unlisted>
							</CC_2>
						</C>
					</Root>
				`,
				inputs: [{ tagName: 'C', id: 'c1' }],
				collect: 'AAAA_1',
				expected: [['aaaa1']],
			},
			'a collected tag the definition does not know → found wherever it sits under the scope': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="v">
								<AAA_1 ${customId}="aaa1" aAAA_1="v">
									<Unlisted ${customId}="unlisted2" />
								</AAA_1>
							</AA_1>
							<Unlisted ${customId}="unlisted1" />
						</A>
					</Root>
				`,
				inputs: [{ tagName: 'A', id: 'a1' }],
				collect: 'Unlisted',
				expected: [['unlisted1', 'unlisted2']],
			},
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('a dialecte with a transparent element', () => {
		const testCases: TestCases<TestCase> = {
			'a collected tag inside a transparent element its definition does not list → found': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<B ${customId}="b1" aB="v">
							<BB_1 ${customId}="bb1" aBB_1="v">
								<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
							</BB_1>
						</B>
					</Root>
				`,
				inputs: [{ tagName: 'B', id: 'b1' }],
				collect: 'AAAA_1',
				expected: [['aaaa1']],
			},
		}

		runTransparentCases.withoutExport({ testCases, act: act as never })
	})
})
