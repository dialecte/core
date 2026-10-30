import { printNode } from './print-node'
import { selectFirstNode, selectNodes } from './select-nodes'
import { countOpenXmlDocuments, withXmlDocument } from './with-xml-document'
import { XmlQueryRefusedError } from './xml-query-refused-error'

import { describe, expect, it } from 'vitest'

import { runTestCases } from '@/test'

import type { XmlDocument, XmlElement, XmlNode } from './xml.types'
import type { BaseTestCase } from '@/test'

const DEFAULT_URI = 'urn:default'
const EXT_URI = 'urn:ext'
const NAMESPACES = { default: DEFAULT_URI, ext: EXT_URI }

const SAMPLE_XML = [
	`<Root xmlns="${DEFAULT_URI}" xmlns:ext="${EXT_URI}" root="1">`,
	'  <A aA="1">',
	'    <B aB="1"/>',
	'    <ext:B ext:aB="2"/>',
	'  </A>',
	'  <A aA="2">',
	'    <B aB="3"/>',
	'  </A>',
	'</Root>',
].join('\n')

describe('withXmlDocument', () => {
	describe('opening and disposing', () => {
		type TestCase = BaseTestCase & { xml: string; expected: number }

		const testCases: Record<string, TestCase> = {
			'well-formed text → what read returns': {
				xml: SAMPLE_XML,
				expected: 2,
			},
			'text with an XML declaration and line breaks around the root → what read returns': {
				xml: `<?xml version="1.0" encoding="UTF-8"?>\r\n${SAMPLE_XML}\r\n`,
				expected: 2,
			},
		}

		function act({ xml, expected }: TestCase) {
			expect(withXmlDocument({ xml, label: 'sample' }, countBElements)).toBe(expected)
			expect(countOpenXmlDocuments()).toBe(0)
		}

		runTestCases.generic(testCases, act)
	})

	it('read throws → the error propagates and the document is disposed', () => {
		expect(() =>
			withXmlDocument({ xml: SAMPLE_XML, label: 'sample' }, function failToRead() {
				throw new Error('read failed')
			}),
		).toThrow('read failed')
		expect(countOpenXmlDocuments()).toBe(0)
	})

	it('read is running → the document is open, and disposed once read returns', () => {
		expect(withXmlDocument({ xml: SAMPLE_XML, label: 'sample' }, countOpenXmlDocuments)).toBe(1)
		expect(countOpenXmlDocuments()).toBe(0)
	})

	describe('malformed text', () => {
		type TestCase = BaseTestCase & {
			xml: string
			line: number
			column: number
			reasonFragment: string
		}

		const testCases: Record<string, TestCase> = {
			'a tag closed by another name → refused at the closing tag': {
				xml: '<Root>\n  <A>\n</Root>',
				line: 3,
				column: 8,
				reasonFragment: 'Opening and ending tag mismatch',
			},
			'a bare & in an attribute value → refused at the entity': {
				xml: '<Root>\n  <A aA="a & b"/>\n</Root>',
				line: 2,
				column: 13,
				reasonFragment: 'xmlParseEntityRef',
			},
			'an element prefix bound to no namespace → refused at the element': {
				xml: '<Root>\n  <p:A/>\n</Root>',
				line: 2,
				column: 7,
				reasonFragment: 'Namespace prefix p on A is not defined',
			},
			'a prefix bound to the empty namespace → refused at the declaration': {
				xml: '<Root>\n<A xmlns:p=""/>\n</Root>',
				line: 2,
				column: 14,
				reasonFragment: 'Empty XML namespace is not allowed',
			},
		}

		function act({ xml, line, column, reasonFragment }: TestCase) {
			const outcome = captureError(() =>
				withXmlDocument({ xml, label: 'fixture' }, function neverRead() {
					return 'read'
				}),
			)
			expect(outcome?.message).toMatch(
				new RegExp(`^fixture: malformed XML - ${line}:${column} \\S`),
			)
			expect(outcome?.message).toContain(reasonFragment)
			expect(countOpenXmlDocuments()).toBe(0)
		}

		runTestCases.generic(testCases, act)
	})
})

describe('selecting nodes', () => {
	describe('with a namespace map', () => {
		type TestCase = BaseTestCase & {
			contextExpression: string | undefined
			expression: string
			expected: string[]
		}

		const testCases: Record<string, TestCase> = {
			'on the document → the nodes in document order': {
				contextExpression: undefined,
				expression: '//default:B | //default:A',
				expected: ['A:1', 'B:1', 'A:2', 'B:3'],
			},
			'on the document, two namespaces → nodes of both, in document order': {
				contextExpression: undefined,
				expression: '//ext:B | //default:B',
				expected: ['B:1', 'B:2', 'B:3'],
			},
			'on an element context → the nodes under it, in document order': {
				contextExpression: '//default:A[@aA="1"]',
				expression: './*',
				expected: ['B:1', 'B:2'],
			},
			'on an element context, an absolute path → the whole document is still reachable': {
				contextExpression: '//default:A[@aA="2"]',
				expression: '//default:A',
				expected: ['A:1', 'A:2'],
			},
			'no node matches → empty': {
				contextExpression: undefined,
				expression: '//default:Missing',
				expected: [],
			},
		}

		function act({ contextExpression, expression, expected }: TestCase) {
			expect(
				withXmlDocument({ xml: SAMPLE_XML, label: 'sample' }, function read(document) {
					const context = resolveContext({ document, contextExpression })
					return selectNodes({ context, expression, namespaces: NAMESPACES }).map(describeElement)
				}),
			).toEqual(expected)
		}

		runTestCases.generic(testCases, act)
	})

	describe('selectFirstNode', () => {
		it('several nodes match → the first in document order', () => {
			expect(
				withXmlDocument({ xml: SAMPLE_XML, label: 'sample' }, function read(document) {
					const node = selectFirstNode({
						context: document,
						expression: '//default:B',
						namespaces: NAMESPACES,
					})
					return node ? describeElement(node) : undefined
				}),
			).toBe('B:1')
		})

		it('no node matches → undefined', () => {
			expect(
				withXmlDocument({ xml: SAMPLE_XML, label: 'sample' }, function read(document) {
					return selectFirstNode({
						context: document,
						expression: '//default:Missing',
						namespaces: NAMESPACES,
					})
				}),
			).toBeUndefined()
		})

		const nonNodeExpressions: Record<string, { expression: string; answer: RegExp }> = {
			'an expression answering a number → refused, naming it and what it answered': {
				expression: 'count(//default:B)',
				answer: /\bnumber\b/,
			},
			'an expression answering a string → refused, naming it and what it answered': {
				expression: 'string(//default:B/@aB)',
				answer: /\bstring\b/,
			},
			'an expression answering a boolean → refused, naming it and what it answered': {
				expression: 'boolean(//default:B)',
				answer: /\bboolean\b/,
			},
		}

		for (const [description, { expression, answer }] of Object.entries(nonNodeExpressions)) {
			it(description, () => {
				const outcome = captureError(() =>
					withXmlDocument({ xml: SAMPLE_XML, label: 'sample' }, function read(document) {
						return selectFirstNode({ context: document, expression, namespaces: NAMESPACES })
					}),
				)
				expect(outcome?.message).toContain(expression)
				expect(outcome?.message.split(expression).join('')).toMatch(answer)
			})
		}
	})

	describe('the kind of a refusal', () => {
		type TestCase = BaseTestCase & { expression: string; kind: string }

		const testCases: Record<string, TestCase> = {
			'a syntax error → syntax': { expression: '//default:A[', kind: 'syntax' },
			'an unbound prefix → unbound-prefix': { expression: '//unknown:A', kind: 'unbound-prefix' },
			'an expression answering a number, through selectNodes → not-a-node-set': {
				expression: 'count(//default:B)',
				kind: 'not-a-node-set',
			},
		}

		function act({ expression, kind }: TestCase) {
			const outcome = captureError(() =>
				withXmlDocument({ xml: SAMPLE_XML, label: 'sample' }, function read(document) {
					return selectNodes({ context: document, expression, namespaces: NAMESPACES })
				}),
			)
			expect(outcome).toBeInstanceOf(XmlQueryRefusedError)
			expect((outcome as XmlQueryRefusedError).kind).toBe(kind)
		}

		runTestCases.generic(testCases, act)
	})

	describe('refused expressions', () => {
		type TestCase = BaseTestCase & { expression: string; reason: RegExp }

		const testCases: Record<string, TestCase> = {
			'an unbound prefix → refused with the expression and the prefix': {
				expression: '//unknown:A',
				reason: /Undefined namespace prefix: unknown/,
			},
			'an unbound prefix after an earlier step that selects nothing → refused all the same': {
				expression: '//default:Missing/unknown:A',
				reason: /Undefined namespace prefix: unknown/,
			},
			'a syntax error → refused with the expression and a reason': {
				expression: '//default:A[',
				reason: /compile|Invalid expression/,
			},
		}

		function act({ expression, reason }: TestCase) {
			const outcome = captureError(() =>
				withXmlDocument({ xml: SAMPLE_XML, label: 'sample' }, function read(document) {
					return selectNodes({ context: document, expression, namespaces: NAMESPACES })
				}),
			)
			expect(outcome?.message).toContain(expression)
			expect(outcome?.message.split(expression).join('')).toMatch(reason)
			expect(countOpenXmlDocuments()).toBe(0)
		}

		runTestCases.generic(testCases, act)
	})

	describe('what the document holds', () => {
		it('namespace declarations → not on the attribute axis', () => {
			expect(
				withXmlDocument({ xml: SAMPLE_XML, label: 'sample' }, function read(document) {
					return {
						rootAttributes: selectNodes({
							context: document,
							expression: '/default:Root/@*',
							namespaces: NAMESPACES,
						}).length,
						declarations: selectNodes({
							context: document,
							expression: '//@*[local-name() = "xmlns" or starts-with(name(), "xmlns:")]',
							namespaces: NAMESPACES,
						}).length,
					}
				}),
			).toEqual({ rootAttributes: 1, declarations: 0 })
		})

		it('an XML declaration and whitespace around the root → the root is the only child of the document', () => {
			const xml = `<?xml version="1.0" encoding="UTF-8"?>\r\n  ${SAMPLE_XML}\r\n`
			expect(withXmlDocument({ xml, label: 'sample' }, countDocumentChildren)).toBe(1)
		})
	})
})

describe('printNode', () => {
	const NESTED_XML = '<Root><A aA="1"><B aB="1"/><B aB="2"/></A></Root>'
	const PREFIXED_XML = `<Root xmlns:ext="${EXT_URI}"><A><ext:AA_3 ext:aAA_3="x"/></A></Root>`

	type TestCase = BaseTestCase & { xml: string; maxLines: number; expected: string }

	const testCases: Record<string, TestCase> = {
		'a node under the line cap → indented XML': {
			xml: NESTED_XML,
			maxLines: 10,
			expected: '<A aA="1">\n  <B aB="1"/>\n  <B aB="2"/>\n</A>',
		},
		'a node of exactly the cap → not cut': {
			xml: NESTED_XML,
			maxLines: 4,
			expected: '<A aA="1">\n  <B aB="1"/>\n  <B aB="2"/>\n</A>',
		},
		'a node over the line cap → cut, saying how many lines were left out': {
			xml: NESTED_XML,
			maxLines: 2,
			expected: '<A aA="1">\n  <B aB="1"/>\n… (2 more lines)',
		},
		'a prefixed element and attribute inside the node → the prefix is kept': {
			xml: PREFIXED_XML,
			maxLines: 10,
			expected: '<A>\n  <ext:AA_3 ext:aAA_3="x"/>\n</A>',
		},
	}

	function act({ xml, maxLines, expected }: TestCase) {
		expect(
			withXmlDocument({ xml, label: 'nested' }, function read(document) {
				const node = selectFirstNode({ context: document, expression: '//A', namespaces: {} })
				if (!node) throw new Error('fixture has no A')
				return printNode({ node, maxLines })
			}),
		).toBe(expected)
	}

	runTestCases.generic(testCases, act)
})

function captureError(run: () => unknown): Error | undefined {
	try {
		run()
	} catch (error) {
		return error as Error
	}
	return undefined
}

function resolveContext(params: {
	document: XmlDocument
	contextExpression: string | undefined
}): XmlDocument | XmlElement {
	const { document, contextExpression } = params
	if (contextExpression === undefined) return document
	const node = selectFirstNode({
		context: document,
		expression: contextExpression,
		namespaces: NAMESPACES,
	})
	if (!node) throw new Error(`fixture has no node for ${contextExpression}`)
	return node as XmlElement
}

function describeElement(node: XmlNode): string {
	const element = node as XmlElement
	return `${element.name}:${element.attrs[0]?.value ?? ''}`
}

function countBElements(document: XmlDocument): number {
	return selectNodes({ context: document, expression: '//default:B', namespaces: NAMESPACES })
		.length
}

function countDocumentChildren(document: XmlDocument): number {
	return selectNodes({ context: document, expression: '/node()', namespaces: {} }).length
}
