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
	id: 'core/test-transparent-snapshot',
	version: '0.0.0',
	configs: {
		[TEST_CONFIG_KEY]: { ...TEST_DIALECTE_CONFIG, transparentElements: ['AA_1'] as const },
	},
	defaultConfigKey: TEST_CONFIG_KEY,
})
const runTransparentCases = createTestRunner({ dialecte: TRANSPARENT_DIALECTE })

/** Contract: a snapshot's `ancestors` counts stored levels, a transparent element included. */
describe('getSnapshot - ancestors through a transparent element', () => {
	type TestCase = BaseXmlTestCase & { expectedStart: string }

	const testCases: TestCases<TestCase> = {
		'AAA_1 under the transparent AA_1, ancestors 1 → the XML starts at AA_1': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="v">
							<AAA_1 ${customId}="aaa1" aAAA_1="v" />
						</AA_1>
					</A>
				</Root>
			`,
			expectedStart: '<AA_1',
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const xml = await source.query.getSnapshot({
			ref: { tagName: 'AAA_1', id: 'aaa1' },
			ancestors: 1,
			as: 'xml',
			declareNamespaces: false,
			includeXmlDeclaration: false,
		})
		expect(xml.trimStart().slice(0, testCase.expectedStart.length)).toBe(testCase.expectedStart)
	}

	runTransparentCases.withoutExport({ testCases, act: act as never })
})
