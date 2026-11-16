import { qualifiedNameOf } from './qualified-name'

import { describe, expect, it } from 'vitest'

describe('qualifiedNameOf - a Clark name names a local name that is an NCName', () => {
	const testCases: Record<string, { value: string; expected: string | undefined }> = {
		'{uri}local → read': { value: '{urn:f}Kind', expected: '{urn:f}Kind' },
		'{}local → read, in no namespace': { value: '{}Kind', expected: 'Kind' },
		'a local name holding a space → none': { value: '{urn:f}b c', expected: undefined },
		'a local name holding a colon → none': { value: '{urn:f}a:b', expected: undefined },
		'a local name starting with a digit → none': { value: '{urn:f}1a', expected: undefined },
	}
	for (const [title, testCase] of Object.entries(testCases)) {
		it(title, () =>
			expect(qualifiedNameOf({ value: testCase.value, namespaceOf: () => undefined })?.clark).toBe(
				testCase.expected,
			),
		)
	}
})
