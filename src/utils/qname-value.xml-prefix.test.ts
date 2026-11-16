import { canonicalQualifiedName, storedNamespaceLookup } from './qname-value'

import { describe, expect, it } from 'vitest'

import { XML_NAMESPACE_URI } from '@/helpers/constant'
import { TEST_DIALECTE_CONFIG } from '@/test'

// the xml prefix is bound in every document: core reads and stores it as XML does

describe('storedNamespaceLookup - the xml prefix', () => {
	it('xml → the XML namespace', () =>
		expect(storedNamespaceLookup({ dialecteConfig: TEST_DIALECTE_CONFIG })('xml')).toBe(
			XML_NAMESPACE_URI,
		))
})

describe('canonicalQualifiedName - a name in the XML namespace', () => {
	const testCases: Record<string, { value: string; expected: string }> = {
		'xml:lang → xml:lang': { value: 'xml:lang', expected: 'xml:lang' },
		'the Clark name of xml:lang → xml:lang': {
			value: `{${XML_NAMESPACE_URI}}lang`,
			expected: 'xml:lang',
		},
	}
	for (const [title, testCase] of Object.entries(testCases)) {
		it(title, () =>
			expect(
				canonicalQualifiedName({
					dialecteConfig: TEST_DIALECTE_CONFIG,
					value: testCase.value,
					namespaceOf: storedNamespaceLookup({ dialecteConfig: TEST_DIALECTE_CONFIG }),
				}),
			).toBe(testCase.expected),
		)
	}
})
