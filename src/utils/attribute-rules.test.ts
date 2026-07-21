import { isSchemaDefaultValue, resolveSchemaAttributeValue } from './attribute-rules'

import { describe, expect } from 'vitest'

import { TEST_DIALECTE_CONFIG, runTestCases } from '@/test'

import type { AttributeDefaults } from './attribute-rules'
import type { BaseTestCase } from '@/test'

const config = TEST_DIALECTE_CONFIG

// ── resolveSchemaAttributeValue ───────────────────────────────────────────────
// Per-attribute schema fill, driven by `defaults`:
//   'none'     → nothing
//   'optional' → fixed ?? (non-empty default)          (read view)
//   'required' → (isRequired || fixed) ? (fixed ?? default ?? '') : undefined   (XSD/export view)

describe('resolveSchemaAttributeValue', () => {
	type TestCase = BaseTestCase & {
		tagName: string
		attributeName: string
		defaults: AttributeDefaults
		expected: string | undefined
	}

	const testCases: Record<string, TestCase> = {
		"'none' injects nothing for a fixed attribute": {
			tagName: 'CC_1',
			attributeName: 'aCC_1',
			defaults: 'none',
			expected: undefined,
		},
		"'optional' returns the fixed value": {
			tagName: 'CC_1',
			attributeName: 'aCC_1',
			defaults: 'optional',
			expected: 'fixed_val',
		},
		"'optional' returns a non-empty default": {
			tagName: 'BBB_1',
			attributeName: 'bBBB_1',
			defaults: 'optional',
			expected: 'false',
		},
		"'optional' skips an empty-string default": {
			tagName: 'BB_1',
			attributeName: 'bBB_1',
			defaults: 'optional',
			expected: undefined,
		},
		"'optional' does not fabricate a required-without-default attribute": {
			tagName: 'AA_1',
			attributeName: 'aAA_1',
			defaults: 'optional',
			expected: undefined,
		},
		"'required' materializes a required-without-default attribute as ''": {
			tagName: 'AA_1',
			attributeName: 'aAA_1',
			defaults: 'required',
			expected: '',
		},
		"'required' returns the fixed value": {
			tagName: 'CC_1',
			attributeName: 'aCC_1',
			defaults: 'required',
			expected: 'fixed_val',
		},
		"'required' does not materialize an optional-only default": {
			tagName: 'BBB_1',
			attributeName: 'bBBB_1',
			defaults: 'required',
			expected: undefined,
		},
		'unknown element yields undefined': {
			tagName: 'Unknown',
			attributeName: 'whatever',
			defaults: 'required',
			expected: undefined,
		},
	}

	runTestCases.generic(testCases, (tc) => {
		const result = resolveSchemaAttributeValue({
			dialecteConfig: config,
			tagName: tc.tagName,
			attributeName: tc.attributeName,
			defaults: tc.defaults,
		})
		expect(result).toBe(tc.expected)
	})
})

// ── isSchemaDefaultValue ──────────────────────────────────────────────────────
// value === (fixed ?? default), matching '' too. Used to drop default-valued attrs at compare.

describe('isSchemaDefaultValue', () => {
	type TestCase = BaseTestCase & {
		tagName: string
		attributeName: string
		value: string
		expected: boolean
	}

	const testCases: Record<string, TestCase> = {
		'true when value equals the schema fixed value': {
			tagName: 'CC_1',
			attributeName: 'aCC_1',
			value: 'fixed_val',
			expected: true,
		},
		'false when value differs from the schema fixed value': {
			tagName: 'CC_1',
			attributeName: 'aCC_1',
			value: 'other',
			expected: false,
		},
		'true when value equals a non-empty schema default': {
			tagName: 'BBB_1',
			attributeName: 'bBBB_1',
			value: 'false',
			expected: true,
		},
		'false when value differs from the schema default': {
			tagName: 'BBB_1',
			attributeName: 'bBBB_1',
			value: 'true',
			expected: false,
		},
		'true when an empty-string default is matched by an empty value': {
			tagName: 'BB_1',
			attributeName: 'bBB_1',
			value: '',
			expected: true,
		},
		'false for an attribute with neither default nor fixed': {
			tagName: 'AA_1',
			attributeName: 'aAA_1',
			value: '',
			expected: false,
		},
		'false for an unknown element': {
			tagName: 'Unknown',
			attributeName: 'whatever',
			value: 'x',
			expected: false,
		},
	}

	runTestCases.generic(testCases, (tc) => {
		const result = isSchemaDefaultValue({
			dialecteConfig: config,
			tagName: tc.tagName,
			attributeName: tc.attributeName,
			value: tc.value,
		})
		expect(result).toBe(tc.expected)
	})
})
