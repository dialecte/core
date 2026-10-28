import { renderLinks } from './render-links.ts'

import { describe, expect, it } from 'vitest'

const CASES = [
	{ key: 'plain link', text: 'Reads {@link getTree}.', expected: 'Reads `getTree`.' },
	{
		key: 'labelled link (pipe)',
		text: 'Reads {@link getTree | the tree}.',
		expected: 'Reads the tree.',
	},
	{
		key: 'labelled link (space)',
		text: 'Reads {@link getTree the tree}.',
		expected: 'Reads the tree.',
	},
	{ key: 'linkcode', text: 'Use {@linkcode findDescendants}.', expected: 'Use `findDescendants`.' },
	{ key: 'two links', text: '{@link a} then {@link b}', expected: '`a` then `b`' },
	{ key: 'no link', text: 'Reads the children.', expected: 'Reads the children.' },
]

describe('renderLinks', () => {
	for (const testCase of CASES) {
		it(testCase.key, () => {
			expect(renderLinks(testCase.text)).toBe(testCase.expected)
		})
	}
})
