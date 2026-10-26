import { parseXmlDocument } from './xml-document-from-file'

import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { runTestCases } from '@/test'

import type { DialecteErrorKey } from '@/errors'
import type { BaseTestCase } from '@/test'

describe('parseXmlDocument', () => {
	type ParsedCase = BaseTestCase & {
		xml: string
		expected: { rootName: string; childCount: number } | { errorKey: DialecteErrorKey }
	}

	const testCases: Record<string, ParsedCase> = {
		'a compact file -> its document, no whitespace-only text node': {
			xml: '<?xml version="1.0" encoding="UTF-8"?><Root xmlns="urn:r"><A a="1"/><B>text</B></Root>',
			expected: { rootName: 'Root', childCount: 2 },
		},
		'a file that is not well-formed -> PARSE_ERROR': {
			xml: '<Root><A></Root>',
			expected: { errorKey: 'PARSE_ERROR' },
		},
	}

	runTestCases.generic(testCases, async (testCase) => {
		const parsed = await parseXmlDocument({ file: new Blob([testCase.xml]) }).catch(
			(error: unknown) => toDialecteError(error)?.key,
		)
		if ('errorKey' in testCase.expected) {
			expect(parsed).toBe(testCase.expected.errorKey)
			return
		}
		const xmlDocument = parsed as XMLDocument
		expect(xmlDocument.documentElement.localName).toBe(testCase.expected.rootName)
		expect(xmlDocument.documentElement.childNodes).toHaveLength(testCase.expected.childCount)
	})
})
