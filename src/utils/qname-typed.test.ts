import {
	mayHoldQualifiedNames,
	qualifiedNameAttributesOf,
	readsQualifiedNames,
} from './qname-typed'

import { describe, expect, it } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test'

import type { DataType } from '@/types'

const VARIANT_TYPE = '{http://dialecte.dev/XML/DEFAULT}tDD_2A'
const variantType = TEST_DIALECTE_CONFIG.types[VARIANT_TYPE]

// tDD_2A with one more attribute, gDD_2 typed xs:QName: declared by the variant only, never by DD_2 itself
const variantQNameConfig = {
	...TEST_DIALECTE_CONFIG,
	types: {
		...TEST_DIALECTE_CONFIG.types,
		[VARIANT_TYPE]: {
			...variantType,
			attributes: {
				...variantType.attributes,
				sequence: [...variantType.attributes.sequence, 'gDD_2'],
				details: { ...variantType.attributes.details, gDD_2: { type: { builtin: 'QName' } } },
			},
		},
	},
}

describe('readsQualifiedNames', () => {
	const testCases: Record<string, { type: DataType | undefined; expected: boolean }> = {
		'xs:QName → true': { type: { builtin: 'QName' }, expected: true },
		'NOTATION with an enumeration → true': {
			type: { builtin: 'NOTATION', facets: { enumeration: ['{urn:f}png'] } },
			expected: true,
		},
		'a list of QNames → true': { type: { list: { builtin: 'QName' } }, expected: true },
		'a union with a QName member → true': {
			type: { union: [{ builtin: 'integer' }, { builtin: 'QName' }] },
			expected: true,
		},
		'a string → false': { type: { builtin: 'string' }, expected: false },
		'a list of integers → false': { type: { list: { builtin: 'integer' } }, expected: false },
		'no type (a plain string) → false': { type: undefined, expected: false },
	}
	for (const [title, testCase] of Object.entries(testCases)) {
		it(title, () => expect(readsQualifiedNames(testCase.type)).toBe(testCase.expected))
	}
})

describe('mayHoldQualifiedNames', () => {
	const testCases: Record<
		string,
		{ config?: typeof variantQNameConfig; tagName: string; expected: boolean }
	> = {
		'EE_1 (QName, NOTATION and QName-list attributes) → true': { tagName: 'EE_1', expected: true },
		'EE_2 (QName text) → true': { tagName: 'EE_2', expected: true },
		'E (string attributes only) → false': { tagName: 'E', expected: false },
		'DD_1 (no QName value in any variant) → false': { tagName: 'DD_1', expected: false },
		'a tag the dialecte does not declare → false': { tagName: 'Unknown', expected: false },
		'DD_2 when its variant tDD_2A declares a QName attribute → true': {
			config: variantQNameConfig,
			tagName: 'DD_2',
			expected: true,
		},
	}
	for (const [title, testCase] of Object.entries(testCases)) {
		it(title, () =>
			expect(
				mayHoldQualifiedNames({
					dialecteConfig: testCase.config ?? TEST_DIALECTE_CONFIG,
					tagName: testCase.tagName,
				}),
			).toBe(testCase.expected),
		)
	}
})

describe('qualifiedNameAttributesOf', () => {
	const testCases: Record<
		string,
		{ config?: typeof variantQNameConfig; tagName: string; expected: string[] }
	> = {
		'EE_1 → its QName, NOTATION and QName-list attributes': {
			tagName: 'EE_1',
			expected: ['aEE_1', 'bEE_1', 'ext:cEE_1'],
		},
		'EE_2 → its union attribute (its QName text is no attribute)': {
			tagName: 'EE_2',
			expected: ['aEE_2'],
		},
		'E (string attributes only) → none': { tagName: 'E', expected: [] },
		'a tag the dialecte does not declare → none': { tagName: 'Unknown', expected: [] },
		'DD_2 when its variant tDD_2A declares a QName attribute → that attribute': {
			config: variantQNameConfig,
			tagName: 'DD_2',
			expected: ['gDD_2'],
		},
	}
	for (const [title, testCase] of Object.entries(testCases)) {
		it(title, () =>
			expect(
				[
					...qualifiedNameAttributesOf({
						dialecteConfig: testCase.config ?? TEST_DIALECTE_CONFIG,
						tagName: testCase.tagName,
					}),
				].sort(),
			).toEqual(testCase.expected),
		)
	}
})
