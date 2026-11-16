import { runOracleCase } from './run-oracle-case'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { OracleCase } from './conformance.types'
import type { BaseTestCase } from '@/test'

/** Every case document, whole, by its path: one `.xml` per case, one defect per document. */
const DOCUMENTS = import.meta.glob<string>('./cases/*.xml', {
	query: '?raw',
	import: 'default',
	eager: true,
})

type TestCase = BaseTestCase & {
	file: string
	expected: OracleCase['expected']
}

/**
 * The expectations come from the rule and the definition, never from libxml2's wording. `at` is the record id the
 * defect sits on; `code` the reason the value is refused; `attribute` the attribute (none for a text value).
 */
const TEST_CASES: Record<string, TestCase> = {
	// base
	'the valid base: every facet within its bound, a preserved and a collapsed value, an ext attribute, the xsi:type variants':
		{
			file: 'valid',
			expected: 'valid',
		},
	// branch A - pattern, enumeration, datatype, length, digits, range, whitespace
	'pattern: a lowercase value where capitals are required → pattern': {
		file: 'attribute-pattern',
		expected: [{ at: 'a1', code: 'pattern', attribute: 'aA' }],
	},
	'pattern of a level below: capitals where three lowercase letters are required → pattern': {
		file: 'attribute-pattern-lowercase-code',
		expected: [{ at: 'aaa4', code: 'pattern', attribute: 'aAAA_1' }],
	},
	'enumeration: a value outside the set → enumeration': {
		file: 'attribute-enumeration',
		expected: [{ at: 'a1', code: 'enumeration', attribute: 'bA' }],
	},
	'datatype: letters where an integer is required → datatype': {
		file: 'attribute-datatype',
		expected: [{ at: 'aa2', code: 'datatype', attribute: 'aAA_2' }],
	},
	'length: a fixed length of eight, four given, on an ext attribute → length': {
		file: 'attribute-ext-length',
		expected: [{ at: 'aaaa4', code: 'length', attribute: 'ext:aAAAA_3' }],
	},
	'fractionDigits: three fraction digits where two are allowed → digits': {
		file: 'attribute-fraction-digits',
		expected: [{ at: 'aaaa2', code: 'digits', attribute: 'aAAAA_2' }],
	},
	'maxInclusive: above the bound → range': {
		file: 'attribute-range',
		expected: [{ at: 'aa2', code: 'range', attribute: 'aAA_2' }],
	},
	'whiteSpace collapse: blanks around a value above the bound are dropped, the value is judged → range':
		{
			file: 'attribute-range-collapsed',
			expected: [{ at: 'aa2', code: 'range', attribute: 'aAA_2' }],
		},
	'whiteSpace replace: blanks around a long name are kept, so it exceeds its maximum length → length':
		{
			file: 'attribute-preserved-whitespace',
			expected: [{ at: 'aa1', code: 'length', attribute: 'aAA_1' }],
		},
	// branch B - typed text
	'text: a blank inside a value that must hold none → pattern, no attribute': {
		file: 'text-pattern',
		expected: [{ at: 'bbbb1', code: 'pattern' }],
	},
	// branch D - xsi:type
	'xsi:type: the abstract type itself, not a variant → datatype on xsi:type': {
		file: 'xsi-type-abstract',
		expected: [{ at: 'dd1', code: 'datatype', attribute: 'xsi:type' }],
	},
	'xsi:type: a prefix bound on the root only, an ancestor → valid': {
		file: 'xsi-type-ancestor-prefix',
		expected: 'valid',
	},
	'xsi:type: a prefix bound nowhere → datatype on xsi:type': {
		file: 'xsi-type-unbound-prefix',
		expected: [{ at: 'dd1', code: 'datatype', attribute: 'xsi:type' }],
	},
}

describe('the oracle: libxml2 says which elements are invalid, the case says why', () => {
	runTestCases.generic<TestCase>(TEST_CASES, async ({ file, expected }) => {
		const document = DOCUMENTS[`./cases/${file}.xml`]
		expect(document).toBeTypeOf('string')
		await expect(
			runOracleCase({ oracleCase: { name: file, document: document ?? '', expected } }),
		).resolves.toBeUndefined()
	})
})
