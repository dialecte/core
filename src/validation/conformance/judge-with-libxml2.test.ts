import attributeRangeDocument from './cases/attribute-range.xml?raw'
import validDocument from './cases/valid.xml?raw'
import { judgeWithLibxml2 } from './judge-with-libxml2'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	runTestCases,
} from '@/test'

import type { BaseTestCase } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

type TestCase = BaseTestCase & {
	document: string
	/** The line of each error libxml2 reports, in order. */
	lines: number[]
}

describe('judgeWithLibxml2', () => {
	runTestCases.generic<TestCase>(
		{
			'a valid document with no child → no error': {
				document: `<Root ${ns} ${customId}="root"/>`,
				lines: [],
			},
			'a valid whole document, an id on every element → no error (the ids are removed before judging)':
				{
					document: validDocument,
					lines: [],
				},
			'a value defect → one error on the line where the start tag ends': {
				document: `<Root ${ns} ${customId}="root">
	<A
		${customId}="a1"
		aA="abc">
		<AA_1 ${customId}="aa1" aAA_1="n">
			<AAA_1 ${customId}="aaa1" aAAA_1="abc">
				<AAAA_1 ${customId}="aaaa1" aAAAA_1="t"/>
			</AAA_1>
		</AA_1>
	</A>
</Root>`,
				lines: [4],
			},
			'a value defect in a whole document → the error stays on its line (ids removed in place)': {
				document: attributeRangeDocument,
				lines: [17],
			},
		},
		({ document, lines }) => {
			expect(judgeWithLibxml2({ document }).map((error) => error.line)).toEqual(lines)
		},
	)

	runTestCases.generic<BaseTestCase & { document: string }>(
		{
			'an error carries libxml2 wording, printed on a mismatch': {
				document: attributeRangeDocument,
			},
		},
		({ document }) => {
			expect(judgeWithLibxml2({ document })[0]?.message.length).toBeGreaterThan(0)
		},
	)
})
