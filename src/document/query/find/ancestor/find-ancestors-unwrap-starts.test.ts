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
	id: 'core/test-transparent-ancestor-starts',
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

/** Contract: a walk whose first parent is transparent, from a ref or from a record given, starts past it. */
describe('findAncestors - a start whose parent is transparent', () => {
	type TestCase = BaseXmlTestCase & { givenAs: 'ref' | 'record'; expectedTagNames: string[] }

	const testCases: TestCases<TestCase> = {
		'AAA_1 given as a ref, its parent AA_1 transparent → A, Root': {
			sourceXml: chainXml,
			givenAs: 'ref',
			expectedTagNames: ['A', 'Root'],
		},
		'AAA_1 given as a record read before → A, Root': {
			sourceXml: chainXml,
			givenAs: 'record',
			expectedTagNames: ['A', 'Root'],
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const ref = { tagName: 'AAA_1', id: 'aaa1' } as const
		const record = await source.query.getRecord(ref)
		const start = testCase.givenAs === 'record' ? record : ref
		const ancestors = await source.query.findAncestors(start)
		expect(ancestors.map((ancestor) => ancestor.tagName)).toEqual(testCase.expectedTagNames)
	}

	runTransparentCases.withoutExport({ testCases, act: act as never })
})

/** Contract: `findAncestorsOfEach` counts `depth` and matches `stopAtTagName` on the kept elements of each chain. */
describe('findAncestorsOfEach - depth and stop past a transparent element', () => {
	type TestCase = BaseXmlTestCase & {
		options: FindAncestorsOptions<TestDialecteConfig>
		expectedTagNames: string[][]
	}

	const testCases: TestCases<TestCase> = {
		'depth 1 → AAA_1 for the first, AA_2 for the second': {
			sourceXml: chainXml,
			options: { depth: 1 },
			expectedTagNames: [['AAA_1'], ['AA_2']],
		},
		'stopAtTagName A → the first chain stops at A past the transparent AA_1': {
			sourceXml: chainXml,
			options: { stopAtTagName: 'A' },
			expectedTagNames: [
				['AAA_1', 'A'],
				['AA_2', 'A'],
			],
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const ancestries = await source.query.findAncestorsOfEach(
			[
				{ tagName: 'AAAA_1', id: 'aaaa1' },
				{ tagName: 'AAA_3', id: 'aaa3' },
			],
			testCase.options,
		)
		expect(ancestries.map((chain) => chain.map((ancestor) => ancestor.tagName))).toEqual(
			testCase.expectedTagNames,
		)
	}

	runTransparentCases.withoutExport({ testCases, act: act as never })
})
