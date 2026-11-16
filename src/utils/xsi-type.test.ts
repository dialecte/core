import { canonicalXsiType, storedNamespaceLookup, resolveXsiType } from './xsi-type'

import { describe, expect, it } from 'vitest'

import { XMLNS_NAMESPACE_URI, XSD_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'
import { DIALECTE_TEST_NAMESPACES, TEST_DIALECTE_CONFIG } from '@/test'

import type { NamespaceLookup } from './xsi-type.types'

const DEFAULT_URI = DIALECTE_TEST_NAMESPACES.default.uri
const EXT_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const FOREIGN_URI = 'urn:f'

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

// a config declaring the prefix `xs` for another namespace
const xsTakenConfig = {
	...TEST_DIALECTE_CONFIG,
	namespaces: {
		...TEST_DIALECTE_CONFIG.namespaces,
		taken: { uri: 'urn:taken', prefix: 'xs' },
	},
}

describe('canonicalXsiType', () => {
	const testCases: Record<
		string,
		{
			config?: typeof TEST_DIALECTE_CONFIG
			value: string
			namespaceOf?: NamespaceLookup
			expected: string
		}
	> = {
		'a type in XSD, written under a document prefix → xs:local': {
			value: 'q:integer',
			expected: 'xs:integer',
		},
		'a type in another namespace → Clark': {
			value: 'f:Kind',
			expected: `{${FOREIGN_URI}}Kind`,
		},
		'a Clark value of an XSD type → xs:local': {
			value: `{${XSD_NAMESPACE_URI}}integer`,
			expected: 'xs:integer',
		},
		'a type in no namespace under xmlns="", the dialecte default not empty → {}local': {
			value: 'Kind',
			namespaceOf: bindings({ '': '' }),
			expected: '{}Kind',
		},
		'a config declaring the prefix xs for another URI, an XSD type → Clark': {
			config: xsTakenConfig,
			value: 'q:integer',
			expected: `{${XSD_NAMESPACE_URI}}integer`,
		},
	}
	for (const [title, testCase] of Object.entries(testCases)) {
		it(title, () =>
			expect(
				canonicalXsiType({
					dialecteConfig: testCase.config ?? TEST_DIALECTE_CONFIG,
					value: testCase.value,
					namespaceOf: testCase.namespaceOf ?? documentBindings,
				}),
			).toBe(testCase.expected),
		)
	}
})

describe('storedNamespaceLookup', () => {
	const testCases: Record<
		string,
		{ config?: typeof TEST_DIALECTE_CONFIG; prefix: string; expected: string | undefined }
	> = {
		'the empty prefix → the dialecte default uri': { prefix: '', expected: DEFAULT_URI },
		'a config prefix → its uri': { prefix: 'ext', expected: EXT_URI },
		'xs → XSD': { prefix: 'xs', expected: XSD_NAMESPACE_URI },
		'xs in a config using xs → the config uri': {
			config: xsTakenConfig,
			prefix: 'xs',
			expected: 'urn:taken',
		},
		'any other prefix → undefined': { prefix: 'q', expected: undefined },
	}
	for (const [title, testCase] of Object.entries(testCases)) {
		it(title, () =>
			expect(
				storedNamespaceLookup({ dialecteConfig: testCase.config ?? TEST_DIALECTE_CONFIG })(
					testCase.prefix,
				),
			).toBe(testCase.expected),
		)
	}
})

describe('resolveXsiType', () => {
	function recordTyped(params: {
		value: string
		declares?: Record<string, string>
		form?: 'created' | 'parsed'
	}) {
		const declarations = Object.entries(params.declares ?? {}).map(([prefix, uri]) =>
			params.form === 'parsed'
				? {
						name: prefix,
						value: uri,
						namespace: { prefix: 'xmlns', uri: XMLNS_NAMESPACE_URI },
					}
				: { name: `xmlns:${prefix}`, value: uri },
		)
		return {
			attributes: [
				{ name: 'xsi:type', value: params.value, namespace: XSI_NAMESPACE },
				...declarations,
			],
		}
	}
	const testCases: Record<
		string,
		{ record: ReturnType<typeof recordTyped>; expected: ReturnType<typeof resolveXsiType> }
	> = {
		'a stored xs:local → XSD': {
			record: recordTyped({ value: 'xs:integer' }),
			expected: {
				clark: `{${XSD_NAMESPACE_URI}}integer`,
				namespace: XSD_NAMESPACE_URI,
				local: 'integer',
			},
		},
		'a prefix only the record declares, as created (xmlns:q) → undefined': {
			record: recordTyped({ value: 'q:Kind', declares: { q: FOREIGN_URI } }),
			expected: undefined,
		},
		'a prefix only the record declares, as parsed (q in the xmlns namespace) → undefined': {
			record: recordTyped({ value: 'q:Kind', declares: { q: FOREIGN_URI }, form: 'parsed' }),
			expected: undefined,
		},
	}
	for (const [title, testCase] of Object.entries(testCases)) {
		it(title, () =>
			expect(
				resolveXsiType({ dialecteConfig: TEST_DIALECTE_CONFIG, record: testCase.record }),
			).toEqual(testCase.expected),
		)
	}
})
