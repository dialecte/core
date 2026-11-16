import { canonicalQNameValue } from './qname-value'

import { describe, expect, it } from 'vitest'

import { XSD_NAMESPACE_URI } from '@/helpers/constant'
import { DIALECTE_TEST_NAMESPACES, TEST_DIALECTE_CONFIG } from '@/test'

import type { NamespaceLookup } from './xsi-type.types'
import type { DataType } from '@/types'

const DEFAULT_URI = DIALECTE_TEST_NAMESPACES.default.uri
const EXT_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const FOREIGN_URI = 'urn:f'

const QNAME: DataType = { builtin: 'QName' }
const NOTATION: DataType = { builtin: 'NOTATION' }
const QNAME_LIST: DataType = { list: { builtin: 'QName' } }
const STRING: DataType = { builtin: 'string' }

/** A document's in-scope bindings. */
function bindings(table: Record<string, string>): NamespaceLookup {
	return (prefix) => table[prefix]
}

const documentBindings = bindings({
	'': DEFAULT_URI,
	e: EXT_URI,
	q: XSD_NAMESPACE_URI,
	f: FOREIGN_URI,
})

describe('canonicalQNameValue', () => {
	const testCases: Record<
		string,
		{ type: DataType; value: string; namespaceOf?: NamespaceLookup; expected: string }
	> = {
		'a QName in the dialecte default namespace → local': {
			type: QNAME,
			value: 'Thing',
			expected: 'Thing',
		},
		'a QName in a config namespace under a document prefix → the config prefix': {
			type: QNAME,
			value: 'e:Thing',
			expected: 'ext:Thing',
		},
		'a QName in XSD under a document prefix → xs:local': {
			type: QNAME,
			value: 'q:integer',
			expected: 'xs:integer',
		},
		'a QName in a namespace only the document binds → Clark': {
			type: QNAME,
			value: 'f:Thing',
			expected: `{${FOREIGN_URI}}Thing`,
		},
		'an unprefixed QName under xmlns="" → {}local': {
			type: QNAME,
			value: 'Thing',
			namespaceOf: bindings({ '': '' }),
			expected: '{}Thing',
		},
		'a QName whose prefix nothing binds → kept as written': {
			type: QNAME,
			value: 'u:Thing',
			expected: 'u:Thing',
		},
		'a QName with XML white space around it → collapsed, then resolved': {
			type: QNAME,
			value: '  f:Thing\n',
			expected: `{${FOREIGN_URI}}Thing`,
		},
		'a NOTATION in a namespace only the document binds → Clark': {
			type: NOTATION,
			value: 'f:png',
			expected: `{${FOREIGN_URI}}png`,
		},
		'a list of QNames → each item resolved, one space between': {
			type: QNAME_LIST,
			value: ' f:a  q:integer\te:b Plain ',
			expected: `{${FOREIGN_URI}}a xs:integer ext:b Plain`,
		},
		'a list item whose prefix nothing binds → that item kept, the others resolved': {
			type: QNAME_LIST,
			value: 'u:a f:b',
			expected: `u:a {${FOREIGN_URI}}b`,
		},
		'a string holding a colon → unchanged': {
			type: STRING,
			value: 'f:Thing',
			expected: 'f:Thing',
		},
	}
	for (const [title, testCase] of Object.entries(testCases)) {
		it(title, () =>
			expect(
				canonicalQNameValue({
					dialecteConfig: TEST_DIALECTE_CONFIG,
					type: testCase.type,
					value: testCase.value,
					namespaceOf: testCase.namespaceOf ?? documentBindings,
				}),
			).toBe(testCase.expected),
		)
	}
})
