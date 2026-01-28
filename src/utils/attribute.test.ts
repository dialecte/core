import { describe, it, expect } from 'vitest'

import { getAttributeValueByName, getAttributesValuesByName } from './attributes'

describe('getAttributeValueByName', () => {
	type TestAttribute = { name: string; value: string }

	type TestCase = {
		description: string
		attributes: TestAttribute[]
		name: string
		expected: string
	}

	const testCases: TestCase[] = [
		{
			description: 'returns attribute value when attribute exists',
			attributes: [
				{ name: 'aA', value: 'value1' },
				{ name: 'bA', value: 'value2' },
			],
			name: 'aA',
			expected: 'value1',
		},
		{
			description: 'returns empty string when attribute does not exist',
			attributes: [{ name: 'aA', value: 'value1' }],
			name: 'nonExistent',
			expected: '',
		},
		{
			description: 'returns empty string when attributes array is empty',
			attributes: [],
			name: 'aA',
			expected: '',
		},
		{
			description: 'returns empty string when attribute value is undefined',
			attributes: [{ name: 'aA', value: undefined as any }],
			name: 'aA',
			expected: '',
		},
		{
			description: 'returns empty string when attribute value is empty string',
			attributes: [{ name: 'aA', value: '' }],
			name: 'aA',
			expected: '',
		},
		{
			description: 'returns first matching attribute when multiple exist',
			attributes: [
				{ name: 'aA', value: 'first' },
				{ name: 'aA', value: 'second' },
			],
			name: 'aA',
			expected: 'first',
		},
		{
			description: 'handles numeric string values',
			attributes: [{ name: 'aA', value: '123' }],
			name: 'aA',
			expected: '123',
		},
	]

	testCases.forEach(({ description, attributes, name, expected }) => {
		it(description, () => {
			const result = getAttributeValueByName({ attributes, name })
			expect(result).toBe(expected)
		})
	})
})

describe('getAttributesValuesByName', () => {
	type TestAttribute = { name: string; value: string }

	type TestCase = {
		description: string
		attributes: TestAttribute[]
		expected: Record<string, string>
	}

	const testCases: TestCase[] = [
		{
			description: 'returns empty object when no attributes',
			attributes: [],
			expected: {},
		},
		{
			description: 'returns single attribute as record',
			attributes: [{ name: 'aA', value: 'value1' }],
			expected: { aA: 'value1' },
		},
		{
			description: 'returns multiple attributes as record',
			attributes: [
				{ name: 'aA', value: 'value1' },
				{ name: 'bA', value: 'value2' },
				{ name: 'cA', value: 'value3' },
			],
			expected: {
				aA: 'value1',
				bA: 'value2',
				cA: 'value3',
			},
		},
		{
			description: 'converts undefined values to empty strings',
			attributes: [
				{ name: 'aA', value: 'value1' },
				{ name: 'bA', value: undefined as any },
			],
			expected: {
				aA: 'value1',
				bA: '',
			},
		},
		{
			description: 'preserves empty string values',
			attributes: [{ name: 'aA', value: '' }],
			expected: { aA: '' },
		},
		{
			description: 'last duplicate attribute wins',
			attributes: [
				{ name: 'aA', value: 'first' },
				{ name: 'aA', value: 'second' },
			],
			expected: { aA: 'second' },
		},
	]

	testCases.forEach(({ description, attributes, expected }) => {
		it(description, () => {
			const result = getAttributesValuesByName({ attributes })
			expect(result).toEqual(expected)
		})
	})
})
