import { inspectXml } from './inspect-xml'

import { describe, expect } from 'vitest'

import { XMLNS_DEFAULT_NAMESPACE, runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap body in the test dialecte root element with the default namespace. */
function xml(body = ''): string {
	return `<Root ${XMLNS_DEFAULT_NAMESPACE}>${body}</Root>`
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('inspectXml', () => {
	describe('element lookup', () => {
		type TestCase = BaseTestCase & {
			input: string
			elements: readonly string[]
			expectedKeys: string[]
			missingKeys?: string[]
		}

		const testCases: Record<string, TestCase> = {
			'A present → report entry defined': {
				input: xml('<A/>'),
				elements: ['A'] as const,
				expectedKeys: ['A'],
			},
			'A absent → report entry undefined': {
				input: xml('<B/>'),
				elements: ['A'] as const,
				expectedKeys: [],
				missingKeys: ['A'],
			},
			'A and B both requested, both present → both defined': {
				input: xml('<A/><B/>'),
				elements: ['A', 'B'] as const,
				expectedKeys: ['A', 'B'],
			},
			'A and B requested, only A present → only A defined': {
				input: xml('<A/>'),
				elements: ['A', 'B'] as const,
				expectedKeys: ['A'],
				missingKeys: ['B'],
			},
			// No config provided (AnyDialecteConfig default) → any element name accepted,
			// even one not declared in the test dialecte schema (mirrors the Project use case).
			'non-schema element present in XML, no config → found': {
				input: xml('<Project/>'),
				elements: ['Project'] as const,
				expectedKeys: ['Project'],
			},
			'non-schema element absent in XML, no config → undefined': {
				input: xml('<A/>'),
				elements: ['Project'] as const,
				expectedKeys: [],
				missingKeys: ['Project'],
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const report = inspectXml(tc.input, { elements: tc.elements })
			for (const key of tc.expectedKeys) {
				expect(report[key], `${key} should be defined`).toBeDefined()
			}
			for (const key of tc.missingKeys ?? []) {
				expect(report[key], `${key} should be undefined`).toBeUndefined()
			}
		})
	})

	describe('attribute extraction', () => {
		type TestCase = BaseTestCase & {
			input: string
			element: string
			expectedAttributes: Record<string, string>
		}

		const testCases: Record<string, TestCase> = {
			'A with one attribute → extracted': {
				input: xml('<A aA="hello"/>'),
				element: 'A',
				expectedAttributes: { aA: 'hello' },
			},
			'A with multiple attributes → all extracted': {
				input: xml('<A aA="hello" bA="world" cA="!"/>'),
				element: 'A',
				expectedAttributes: { aA: 'hello', bA: 'world', cA: '!' },
			},
			'A with no attributes → empty object': {
				input: xml('<A/>'),
				element: 'A',
				expectedAttributes: {},
			},
			'A with namespace-prefixed attribute → local name used as key': {
				input: `<Root ${XMLNS_DEFAULT_NAMESPACE} xmlns:ext="http://dialecte.dev/XML/DEV-EXT"><A ext:uuid="abc"/></Root>`,
				element: 'A',
				expectedAttributes: { uuid: 'abc' },
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const report = inspectXml(tc.input, { elements: [tc.element] as const })
			const entry = report[tc.element]
			expect(entry).toBeDefined()
			expect(entry!.attributes).toMatchObject(tc.expectedAttributes)
		})
	})

	describe('value extraction', () => {
		type TestCase = BaseTestCase & {
			input: string
			element: string
			expectedValue: string
		}

		const testCases: Record<string, TestCase> = {
			'AA_1 with inline text → captured': {
				input: xml('<A><AA_1>hello</AA_1></A>'),
				element: 'AA_1',
				expectedValue: 'hello',
			},
			'AA_1 with CDATA section → captured': {
				input: xml('<A><AA_1><![CDATA[raw content]]></AA_1></A>'),
				element: 'AA_1',
				expectedValue: 'raw content',
			},
			'A self-closing → empty string': {
				input: xml('<A/>'),
				element: 'A',
				expectedValue: '',
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const report = inspectXml(tc.input, { elements: [tc.element] as const })
			const entry = report[tc.element]
			expect(entry).toBeDefined()
			expect(entry!.value).toBe(tc.expectedValue)
		})
	})

	describe('early exit', () => {
		type TestCase = BaseTestCase & {
			input: string
			elements: readonly string[]
		}

		const testCases: Record<string, TestCase> = {
			'Root found at first tag → does not error on subsequent content': {
				// Root is the very first element; parser exits before processing A, B, C children
				input: xml('<A/><B/><C/>'),
				elements: ['Root'] as const,
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const report = inspectXml(tc.input, { elements: tc.elements })
			expect(report['Root']).toBeDefined()
		})
	})

	describe('malformed XML', () => {
		type TestCase = BaseTestCase & {
			input: string
			element: string
		}

		const testCases: Record<string, TestCase> = {
			'unclosed tag → SAX lenient, element not found, no throw': {
				input: '<A',
				element: 'A',
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const report = inspectXml(tc.input, { elements: [tc.element] as const })
			expect(report[tc.element]).toBeUndefined()
		})
	})
})
