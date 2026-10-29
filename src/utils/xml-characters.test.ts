import { notXmlCharacterOf } from './xml-characters'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

describe('notXmlCharacterOf', () => {
	type TestCase = BaseTestCase & {
		text: string
		expected: string | undefined
	}

	const testCases: Record<string, TestCase> = {
		'the empty text → none': { text: '', expected: undefined },
		'tab, line feed, carriage return, space → none': { text: '\t\n\r x', expected: undefined },
		'a no-break space, a byte order mark, U+2028, U+FFFD → none': {
			text: '\u{A0}\u{FEFF}\u{2028}\u{FFFD}',
			expected: undefined,
		},
		'a surrogate pair → none': { text: '\u{1D11E}', expected: undefined },
		'NUL → U+0000': { text: 'x\u{0}', expected: 'U+0000' },
		'a vertical tab → U+000B': { text: 'x\u{B}', expected: 'U+000B' },
		'a form feed → U+000C': { text: '\u{C}x', expected: 'U+000C' },
		'U+0001 → U+0001': { text: '\u{1}', expected: 'U+0001' },
		'U+001F → U+001F': { text: '\u{1F}', expected: 'U+001F' },
		'U+FFFE → U+FFFE': { text: '\u{FFFE}', expected: 'U+FFFE' },
		'U+FFFF → U+FFFF': { text: '\u{FFFF}', expected: 'U+FFFF' },
		'two of them → the first': { text: 'a\u{C}b\u{B}', expected: 'U+000C' },
	}

	runTestCases.generic(testCases, function expectFound(testCase) {
		expect(notXmlCharacterOf({ text: testCase.text })).toBe(testCase.expected)
	})
})
