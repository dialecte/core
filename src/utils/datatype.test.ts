import { enumeratedValues, valuePatterns } from './datatype'

import { describe, expect, it } from 'vitest'

import type { DataType } from '@/types'

describe('enumeratedValues', () => {
	const testCases: Record<string, { datatype: DataType | undefined; expected: string[] }> = {
		'an enumeration of its own -> its values': {
			datatype: { builtin: 'token', facets: { enumeration: ['a', 'b'] } },
			expected: ['a', 'b'],
		},
		'a union -> the values its members enumerate, once each': {
			datatype: {
				union: [
					{ union: [{ builtin: 'Name', facets: { enumeration: ['A', 'B'] } }] },
					{ builtin: 'Name', facets: { enumeration: ['B', 'C'] } },
					{ builtin: 'Name', facets: { pattern: [['[A-Z]+']] } },
				],
			},
			expected: ['A', 'B', 'C'],
		},
		'a restriction of a union enumerating its own -> its own only': {
			datatype: {
				union: [{ builtin: 'Name', facets: { enumeration: ['A'] } }],
				facets: { enumeration: ['Z'] },
			},
			expected: ['Z'],
		},
		'no enumeration -> none': { datatype: { builtin: 'string' }, expected: [] },
		'no datatype -> none': { datatype: undefined, expected: [] },
	}
	for (const [name, { datatype, expected }] of Object.entries(testCases)) {
		it(name, () => expect(enumeratedValues(datatype)).toEqual(expected))
	}
})

describe('valuePatterns', () => {
	// two levels: each must match; one pattern of a level is enough
	const patterns = valuePatterns({
		builtin: 'normalizedString',
		facets: { pattern: [['[a-z]+', '[0-9]+'], ['.{2,3}']] },
	})
	const testCases: Record<string, { value: string; expected: boolean }> = {
		'a value matching one pattern of every level -> matches all': { value: 'ab', expected: true },
		'a value matching the other pattern of a level -> matches all': {
			value: '123',
			expected: true,
		},
		'a value one level refuses -> does not': { value: 'abcd', expected: false },
		'a value matching a pattern only in part -> does not (anchored)': {
			value: 'ab1',
			expected: false,
		},
	}
	for (const [name, { value, expected }] of Object.entries(testCases)) {
		it(name, () => expect(patterns.every((pattern) => pattern.test(value))).toBe(expected))
	}

	it('two levels of two alternatives read twice -> one pattern per level, each the same compiled one', () => {
		const datatype: DataType = {
			builtin: 'string',
			facets: {
				pattern: [
					['[a-z]+', '[0-9]+'],
					['.{2,3}', 'x+'],
				],
			},
		}
		const first = valuePatterns(datatype)
		const second = valuePatterns(datatype)
		expect(first).toHaveLength(2)
		expect(second).toHaveLength(2)
		expect(first[0]).toBe(second[0])
		expect(first[1]).toBe(second[1])
		expect(first[0]).not.toBe(first[1])
	})

	it('another pattern on the same builtin -> another compiled pattern', () => {
		const [lower] = valuePatterns({ builtin: 'string', facets: { pattern: [['[a-z]+']] } })
		const [digits] = valuePatterns({ builtin: 'string', facets: { pattern: [['[0-9]+']] } })
		expect(lower).not.toBe(digits)
		expect(lower?.test('abc')).toBe(true)
		expect(digits?.test('abc')).toBe(false)
	})

	it('patterns written for the u flag -> compiled with it', () => {
		const [named] = valuePatterns({ builtin: 'string', facets: { pattern: [['\\p{Lu}']] } })
		expect(named?.test('É')).toBe(true)
	})
})
