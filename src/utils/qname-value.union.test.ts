import { canonicalQNameValue } from './qname-value'

import { describe, expect, it } from 'vitest'

import { DIALECTE_TEST_NAMESPACES, TEST_DIALECTE_CONFIG } from '@/test'

import type { DataType } from '@/types'

const EXT_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const FOREIGN_URI = 'urn:f'

const QNAME: DataType = { builtin: 'QName' }
const INTEGER: DataType = { builtin: 'integer' }
const STRING: DataType = { builtin: 'string' }

/** The in-scope bindings of a document holding `f` (foreign) and `e` (the ext namespace). */
function documentBindings(prefix: string): string | undefined {
	return ({ e: EXT_URI, f: FOREIGN_URI } as Record<string, string>)[prefix]
}

describe('canonicalQNameValue - a union: the first member whose lexical space admits the value reads it', () => {
	const testCases: Record<
		string,
		{ type: DataType; value: string; lexicalOnly?: boolean; expected: string }
	> = {
		'integer | QName, an integer → as written': {
			type: { union: [INTEGER, QNAME] },
			value: '12',
			expected: '12',
		},
		'integer | QName, a QName of a foreign prefix → Clark': {
			type: { union: [INTEGER, QNAME] },
			value: 'f:Kind',
			expected: `{${FOREIGN_URI}}Kind`,
		},
		'string | QName, a QName → the string member: as written': {
			type: { union: [STRING, QNAME] },
			value: 'f:Kind',
			expected: 'f:Kind',
		},
		'QName | string, a prefix nothing binds → the string member: as written': {
			type: { union: [QNAME, STRING] },
			value: 'u:Kind',
			expected: 'u:Kind',
		},
		'QName | string, a bound prefix → the QName member: the config prefix': {
			type: { union: [QNAME, STRING] },
			value: 'e:Kind',
			expected: 'ext:Kind',
		},
		'a QName member whose enumeration refuses the name, then string → the string member: as written':
			{
				type: {
					union: [{ builtin: 'QName', facets: { enumeration: [`{${FOREIGN_URI}}Other`] } }, STRING],
				},
				value: 'f:Kind',
				expected: 'f:Kind',
			},
		'a nested union (integer | (QName | string)) → the nested QName member': {
			type: { union: [INTEGER, { union: [QNAME, STRING] }] },
			value: 'f:Kind',
			expected: `{${FOREIGN_URI}}Kind`,
		},
		'integer | list of QName, two names → each item resolved': {
			type: { union: [INTEGER, { list: QNAME }] },
			value: ' f:a  e:b ',
			expected: `{${FOREIGN_URI}}a ext:b`,
		},
		'QName | string, a Clark name read from a file → the string member: as written': {
			type: { union: [QNAME, STRING] },
			value: `{${EXT_URI}}Kind`,
			lexicalOnly: true,
			expected: `{${EXT_URI}}Kind`,
		},
		'QName | string, a Clark name in the stored form → the QName member: the config prefix': {
			type: { union: [QNAME, STRING] },
			value: `{${EXT_URI}}Kind`,
			expected: 'ext:Kind',
		},
		'a union with no QName member → as written': {
			type: { union: [INTEGER, STRING] },
			value: 'f:Kind',
			expected: 'f:Kind',
		},
	}
	for (const [title, testCase] of Object.entries(testCases)) {
		it(title, () =>
			expect(
				canonicalQNameValue({
					dialecteConfig: TEST_DIALECTE_CONFIG,
					type: testCase.type,
					value: testCase.value,
					namespaceOf: documentBindings,
					lexicalOnly: testCase.lexicalOnly,
				}),
			).toBe(testCase.expected),
		)
	}
})
