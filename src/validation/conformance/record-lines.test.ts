import { recordIdsByLine } from './record-lines'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

const customId = CUSTOM_RECORD_ID_ATTRIBUTE
const ns = XMLNS_DEV_NAMESPACE

type TestCase = BaseTestCase & {
	document: string
	/** The map as `[line, id]` pairs, or the text the refusal carries. */
	expected: { entries: [number, string][] } | { throws: string }
}

describe('recordIdsByLine', () => {
	runTestCases.generic<TestCase>(
		{
			'a normal document → each start tag line to its id': {
				document: `<Root ${ns} ${customId}="root">
	<A ${customId}="a1">
		<AA_1 ${customId}="aa1"/>
	</A>
	<B ${customId}="b1"/>
</Root>`,
				expected: {
					entries: [
						[1, 'root'],
						[2, 'a1'],
						[3, 'aa1'],
						[5, 'b1'],
					],
				},
			},
			'a start tag over several lines → mapped to the line where it ends': {
				document: `<Root ${ns} ${customId}="root">
	<A
		${customId}="a1"
		aA="x">
		<AA_1 ${customId}="aa1"/>
	</A>
</Root>`,
				expected: {
					entries: [
						[1, 'root'],
						[4, 'a1'],
						[5, 'aa1'],
					],
				},
			},
			'a start tag whose attribute value holds a line break → mapped to the line where it ends': {
				document: `<Root ${ns} ${customId}="root">
	<A ${customId}="a1" aA="x
y"/>
</Root>`,
				expected: {
					entries: [
						[1, 'root'],
						[3, 'a1'],
					],
				},
			},
			'two element starts ending on one line → throws naming the line': {
				document: `<Root ${ns} ${customId}="root">
	<A ${customId}="a1"><AA_1 ${customId}="aa1"/></A>
</Root>`,
				expected: { throws: 'line 2' },
			},
			'an element without the id attribute → throws naming its tag': {
				document: `<Root ${ns} ${customId}="root">
	<A ${customId}="a1">
		<AA_1/>
	</A>
</Root>`,
				expected: { throws: "element 'AA_1'" },
			},
		},
		({ document, expected }) => {
			if ('throws' in expected) {
				expect(() => recordIdsByLine({ document })).toThrow(expected.throws)
				return
			}
			expect([...recordIdsByLine({ document })]).toEqual(expected.entries)
		},
	)
})
