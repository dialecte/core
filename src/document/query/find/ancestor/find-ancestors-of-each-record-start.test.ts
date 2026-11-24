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

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** The test dialecte with AA_1 a transparent element. */
const TRANSPARENT_DIALECTE = defineDialecte({
	id: 'core/test-transparent-record-start',
	version: '0.0.0',
	configs: {
		[TEST_CONFIG_KEY]: { ...TEST_DIALECTE_CONFIG, transparentElements: ['AA_1'] as const },
	},
	defaultConfigKey: TEST_CONFIG_KEY,
})
const runTransparentCases = createTestRunner({ dialecte: TRANSPARENT_DIALECTE })

/** Contract: a record given as it is starts its walk from its own `parent`, past a transparent one. */
describe('findAncestorsOfEach - a record given whose parent is transparent', () => {
	type TestCase = BaseXmlTestCase & { expectedTagNames: string[][] }

	const testCases: TestCases<TestCase> = {
		'AAA_1 read before and given as a record, its parent AA_1 transparent → A, Root': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
					</A>
				</Root>
			`,
			expectedTagNames: [['A', 'Root']],
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const record = await source.query.getRecord({ tagName: 'AAA_1', id: 'aaa1' })
		if (!record) throw new Error('AAA_1 not read')
		const ancestries = await source.query.findAncestorsOfEach([record])
		expect(ancestries.map((chain) => chain.map((ancestor) => ancestor.tagName))).toEqual(
			testCase.expectedTagNames,
		)
	}

	runTransparentCases.withoutExport({ testCases, act: act as never })
})
