import { createXPathDocument } from './create-xpath-document'
import { evaluateXPath } from './evaluate-xpath'
import { parseXml } from './parse-xml'

import { describe, expect, it } from 'vitest'

import type { XPathValue } from './xml-dom.types'

const NAMESPACES: Record<string, string> = { default: 'urn:d' }

function evaluate(params: { xml: string; expression: string }): XPathValue {
	const { xml, expression } = params
	const parsed = parseXml({ xml })
	if ('error' in parsed) throw new Error(parsed.error)
	const xpathDocument = createXPathDocument({ original: parsed.document })
	return evaluateXPath({
		expression,
		xpathDocument,
		namespaceResolver: (prefix) => NAMESPACES[prefix] ?? null,
	})
}

describe('evaluateXPath reads a document as XPath 1.0 does', () => {
	const declared = '<?xml version="1.0" encoding="UTF-8"?>\r\n<Root xmlns="urn:d"><A/></Root>\r\n'

	it('an XML declaration and the line breaks around the root → no node of the document: one child, the root', () => {
		expect(evaluate({ xml: declared, expression: 'count(/node())' })).toBe(1)
		expect(evaluate({ xml: declared, expression: 'count(/processing-instruction())' })).toBe(0)
	})

	it('a prefix no namespace is bound to → refused, even where an earlier step already selects nothing', () => {
		expect(() => evaluate({ xml: declared, expression: '//default:Missing/unknown:A' })).toThrow(
			/unknown/,
		)
	})

	it('a prefix no namespace is bound to, after an axis → refused', () => {
		expect(() =>
			evaluate({ xml: declared, expression: '//default:A/following-sibling::unknown:B' }),
		).toThrow(/unknown/)
	})

	it('a prefix in a string literal or an axis name → not a prefix', () => {
		expect(
			evaluate({
				xml: declared,
				expression: '//default:A[not(@x = "a:b")]/ancestor::default:Root',
			}),
		).toHaveLength(1)
	})

	it('a node selected on the copy with no node at its place in the original → refused, naming the place', () => {
		const copy = parseXml({ xml: '<Root xmlns="urn:d"><A/><B/></Root>' })
		const original = parseXml({ xml: '<Root xmlns="urn:d"><A/></Root>' })
		if ('error' in copy || 'error' in original) throw new Error('fixtures not well-formed')
		const xpathDocument = { view: copy.document, original: original.document }
		expect(() =>
			evaluateXPath({
				expression: '//default:B',
				xpathDocument,
				namespaceResolver: (prefix) => NAMESPACES[prefix] ?? null,
			}),
		).toThrow(/no node at \/0\/1 in the original document/)
	})
})
