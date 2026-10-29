import { collapseXmlWhitespace, readXmlTextRun, trimXmlWhitespace } from './xml-whitespace'
import { NOT_XML_WHITESPACE } from './xml-whitespace.fixtures.constants'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

describe('trimXmlWhitespace', () => {
	type TestCase = BaseTestCase & {
		text: string
		expected: string
		/** Whether JavaScript's `trim` answers otherwise: the XML set told apart from JavaScript's */
		javaScriptDiffers?: boolean
	}

	const testCases: Record<string, TestCase> = {
		'the empty text → the empty text': { text: '', expected: '' },
		'XML whitespace only → the empty text': { text: ' \t\r\n \n', expected: '' },
		'XML whitespace at both ends → stripped': { text: ' \t\r\nx y\r\n\t ', expected: 'x y' },
		'XML whitespace inside → kept': { text: 'x \t\r\n y', expected: 'x \t\r\n y' },
		'nothing to trim → as written': { text: 'x', expected: 'x' },
		...Object.fromEntries(
			Object.entries(NOT_XML_WHITESPACE).map(function keptAtBothEnds([name, notWhitespace]) {
				const { character, javaScriptTrims } = notWhitespace
				return [
					`${name} at both ends, inside XML whitespace → kept${javaScriptTrims ? ', where JavaScript drops it' : ''}`,
					{
						text: ` ${character}x${character}\n`,
						expected: `${character}x${character}`,
						javaScriptDiffers: javaScriptTrims,
					},
				]
			}),
		),
	}

	runTestCases.generic(testCases, function expectTrimmed(testCase) {
		expect(trimXmlWhitespace({ text: testCase.text })).toBe(testCase.expected)
		expect(testCase.text.trim() !== testCase.expected).toBe(testCase.javaScriptDiffers ?? false)
	})
})

describe('collapseXmlWhitespace', () => {
	type TestCase = BaseTestCase & {
		text: string
		expected: string
	}

	const testCases: Record<string, TestCase> = {
		'the empty text → the empty text': { text: '', expected: '' },
		'a run of the four XML whitespace characters → one space': {
			text: 'x \t\r\n y',
			expected: 'x y',
		},
		'one tab → one space': { text: 'x\ty', expected: 'x y' },
		'a run at either end → one space': { text: '\n\tx\r\n', expected: ' x ' },
		'nothing to collapse → as written': { text: 'x y', expected: 'x y' },
		...Object.fromEntries(
			Object.entries(NOT_XML_WHITESPACE).map(function keptBetweenRuns([name, { character }]) {
				return [
					`${name} twice between XML whitespace runs → kept, each run one space`,
					{ text: `x \t${character}${character}\n y`, expected: `x ${character}${character} y` },
				]
			}),
		),
	}

	runTestCases.generic(testCases, function expectCollapsed(testCase) {
		expect(collapseXmlWhitespace({ text: testCase.text })).toBe(testCase.expected)
	})
})

describe('readXmlTextRun', () => {
	type TestCase = BaseTestCase & {
		text: string
		expected: string
	}

	const testCases: Record<string, TestCase> = {
		'indentation → the empty text': { text: '\r\n\t\t', expected: '' },
		'padded and split by XML whitespace → trimmed, the inner run one space': {
			text: ' \tx \r\n y\n',
			expected: 'x y',
		},
		'a no-break space at the ends and twice inside → kept': {
			text: '\u{A0}a\u{A0}\u{A0}b\u{A0}',
			expected: '\u{A0}a\u{A0}\u{A0}b\u{A0}',
		},
	}

	runTestCases.generic(testCases, function expectRead(testCase) {
		expect(readXmlTextRun({ text: testCase.text })).toBe(testCase.expected)
	})
})
