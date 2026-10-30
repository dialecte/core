import {
	XmlAttribute,
	XmlElement,
	XmlQueryRefusedError,
	selectNodes,
	withXmlDocument,
} from './index'

import { expect } from 'vitest'

import { runTestCases } from '@/test'
import { splitXpathIntoSteps } from '@/test/assert-xml/xpath-parser'

import type { XmlDocument, XmlNode } from './index'
import type { BaseTestCase } from '@/test'

// The seam (libxml2 in the page) against the page's own engine (DOMParser and document.evaluate), on the
// expressions where two XPath engines part most easily. Both must answer the same: the same value, the same
// nodes at the same places, the same step where an expression stops.

const NAMESPACES: Record<string, string> = { default: 'urn:d', e: 'urn:e', f: 'urn:f' }

const DOCUMENT_XML = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<!-- a comment before the root -->',
	'<Root xmlns="urn:d" xmlns:e="urn:e" root="1">',
	'  <A aA="x &amp; y" e:aE="ext">',
	'    <AA_1 aAA_1="1"/>',
	'    <AA_1 aAA_1="2"/>',
	'    <e:AA_3 e:aAA_3="3"/>',
	'  </A>',
	'  <B><![CDATA[a<b]]></B>',
	'  <C>text &lt; here &#x41;</C>',
	'  <D/>',
	'  <E xmlns="urn:other"><F/></E>',
	'  <G xmlns:f="urn:f" e:v="1" f:v="2"/>',
	'</Root>',
].join('\n')

type NodeKind = 'element' | 'attribute' | 'text' | 'comment'

/** A node as both engines are compared on: what it is, where it sits, its namespace and what it holds. */
type NodeSignature = { kind: NodeKind; path: string; namespace: string; content: string }

/** What an engine answers: a value, the nodes, or that it refused the expression. */
type EngineAnswer =
	| { value: string | number | boolean }
	| { nodes: NodeSignature[] }
	| { refused: true }

type TestCase = BaseTestCase & { expression: string }

type EngineAnswerer = (params: { expression: string }) => EngineAnswer

function resolvePrefix(prefix: string | null): string | null {
	return prefix === null ? null : (NAMESPACES[prefix] ?? null)
}

//====== THE PAGE ======//

function pageStep(node: Node): string {
	if (node.nodeType === Node.ELEMENT_NODE) {
		const element = node as Element
		let position = 1
		for (
			let sibling = element.previousElementSibling;
			sibling;
			sibling = sibling.previousElementSibling
		) {
			if (
				sibling.localName === element.localName &&
				sibling.namespaceURI === element.namespaceURI
			) {
				position += 1
			}
		}
		return `${element.tagName}[${position}]`
	}
	const kind = node.nodeType === Node.COMMENT_NODE ? 'comment()' : 'text()'
	let position = 1
	for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
		if (isSameTextKind(sibling, node)) position += 1
	}
	return `${kind}[${position}]`
}

function isSameTextKind(left: Node, right: Node): boolean {
	const isText = (node: Node) =>
		node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE
	return isText(left) ? isText(right) : left.nodeType === right.nodeType
}

function pagePath(node: Node): string {
	if (node.nodeType === Node.ATTRIBUTE_NODE) {
		const attribute = node as Attr
		return `${pagePath(attribute.ownerElement as Element)}/@${attribute.name}`
	}
	const steps: string[] = []
	for (
		let current: Node | null = node;
		current && current.nodeType !== Node.DOCUMENT_NODE;
		current = current.parentNode
	) {
		steps.unshift(pageStep(current))
	}
	return `/${steps.join('/')}`
}

function signatureOfPageNode(node: Node): NodeSignature {
	const path = pagePath(node)
	if (node.nodeType === Node.ATTRIBUTE_NODE) {
		const attribute = node as Attr
		return {
			kind: 'attribute',
			path,
			namespace: attribute.namespaceURI ?? '',
			content: attribute.value,
		}
	}
	if (node.nodeType === Node.ELEMENT_NODE) {
		const element = node as Element
		const attributes = Array.from(element.attributes)
			.filter((attribute) => attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:'))
			.map(
				(attribute) => `${attribute.namespaceURI ?? ''}|${attribute.localName}=${attribute.value}`,
			)
			.sort()
		return {
			kind: 'element',
			path,
			namespace: element.namespaceURI ?? '',
			content: `${attributes.join(',')}|${element.textContent}`,
		}
	}
	return {
		kind: node.nodeType === Node.COMMENT_NODE ? 'comment' : 'text',
		path,
		namespace: '',
		content: node.nodeValue ?? '',
	}
}

/** The page's answer: DOMParser + document.evaluate. */
function answerOfPage(params: { expression: string }): EngineAnswer {
	const { expression } = params
	const pageDocument = new DOMParser().parseFromString(DOCUMENT_XML, 'application/xml')
	try {
		const any = pageDocument.evaluate(
			expression,
			pageDocument,
			resolvePrefix,
			XPathResult.ANY_TYPE,
			null,
		)
		if (any.resultType === XPathResult.NUMBER_TYPE) return { value: any.numberValue }
		if (any.resultType === XPathResult.STRING_TYPE) return { value: any.stringValue }
		if (any.resultType === XPathResult.BOOLEAN_TYPE) return { value: any.booleanValue }
		const snapshot = pageDocument.evaluate(
			expression,
			pageDocument,
			resolvePrefix,
			XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
			null,
		)
		const nodes = Array.from({ length: snapshot.snapshotLength }, (_, index) =>
			signatureOfPageNode(snapshot.snapshotItem(index) as Node),
		)
		return { nodes }
	} catch {
		return { refused: true }
	}
}

//====== THE SEAM ======//

function seamNodeKind(node: XmlNode): NodeKind {
	if (node instanceof XmlElement) return 'element'
	if (node instanceof XmlAttribute) return 'attribute'
	return node.constructor.name === 'XmlComment' ? 'comment' : 'text'
}

function seamStep(node: XmlNode): string {
	const kind = seamNodeKind(node)
	if (kind === 'element') {
		const element = node as XmlNode & {
			name: string
			prefix: string
			namespaceUri: string
			prev: unknown
		}
		let position = 1
		for (
			let sibling = element.prev as typeof element | null;
			sibling;
			sibling = sibling.prev as typeof element | null
		) {
			if (
				seamNodeKind(sibling) === 'element' &&
				sibling.name === element.name &&
				sibling.namespaceUri === element.namespaceUri
			) {
				position += 1
			}
		}
		return `${element.prefix ? `${element.prefix}:` : ''}${element.name}[${position}]`
	}
	let position = 1
	const sibling = node as XmlNode & { prev?: XmlNode | null }
	for (
		let previous = sibling.prev ?? null;
		previous;
		previous = (previous as typeof sibling).prev ?? null
	) {
		const previousKind = seamNodeKind(previous)
		if (previousKind === kind) position += 1
	}
	return `${kind === 'comment' ? 'comment()' : 'text()'}[${position}]`
}

function seamPath(node: XmlNode): string {
	if (seamNodeKind(node) === 'attribute') {
		const attribute = node as XmlNode & { name: string; prefix: string }
		const owner = attribute.parent as XmlNode
		return `${seamPath(owner)}/@${attribute.prefix ? `${attribute.prefix}:` : ''}${attribute.name}`
	}
	const steps: string[] = []
	for (let current: XmlNode | null = node; current; current = current.parent) {
		steps.unshift(seamStep(current))
	}
	return `/${steps.join('/')}`
}

function signatureOfSeamNode(node: XmlNode): NodeSignature {
	const kind = seamNodeKind(node)
	const path = seamPath(node)
	if (kind === 'attribute') {
		const attribute = node as XmlNode & { namespaceUri: string; value: string }
		return { kind, path, namespace: attribute.namespaceUri, content: attribute.value }
	}
	if (kind === 'element') {
		const element = node as XmlNode & {
			namespaceUri: string
			attrs: { namespaceUri: string; name: string; value: string }[]
		}
		const attributes = element.attrs
			.map((attribute) => `${attribute.namespaceUri}|${attribute.name}=${attribute.value}`)
			.sort()
		return {
			kind,
			path,
			namespace: element.namespaceUri,
			content: `${attributes.join(',')}|${node.content}`,
		}
	}
	return { kind, path, namespace: '', content: node.content }
}

function evaluateOnSeamDocument(params: {
	document: XmlDocument
	expression: string
}): EngineAnswer {
	const { document, expression } = params
	try {
		const nodes = selectNodes({ context: document, expression, namespaces: NAMESPACES })
		return { nodes: nodes.map(signatureOfSeamNode) }
	} catch (error) {
		if (!(error instanceof XmlQueryRefusedError)) throw error
		if (error.kind !== 'not-a-node-set') return { refused: true }
	}
	// a number, a string or a boolean: the seam selects nodes only, the document answers a value itself
	const value = document.eval(expression, NAMESPACES)
	return { value: value as string | number | boolean }
}

/** The seam's answer: libxml2 through `withXmlDocument`. */
function answerOfSeam(params: { expression: string }): EngineAnswer {
	const { expression } = params
	return withXmlDocument(
		{ xml: DOCUMENT_XML, label: 'parity document' },
		function evaluate(document) {
			return evaluateOnSeamDocument({ document, expression })
		},
	)
}

/** The first step of the expression that selects nothing, by an engine; `-1` when every step selects a node. */
function firstEmptyStep(params: { expression: string; answer: EngineAnswerer }): number {
	const { expression, answer } = params
	const steps = splitXpathIntoSteps(expression)
	return steps.findIndex(function selectsNothing(step) {
		const stepAnswer = answer({ expression: step })
		return 'nodes' in stepAnswer && stepAnswer.nodes.length === 0
	})
}

const testCases: Record<string, TestCase> = {
	'the default namespace, through its prefix': { expression: '//default:A' },
	'a prefixed namespace': { expression: '//e:AA_3[@e:aAA_3="3"]' },
	'the default namespace does not hold a prefixed element': { expression: '//default:AA_3' },
	'no prefix → no namespace: nothing': { expression: '//AA_1' },
	'a prefix the resolver lacks → refused': { expression: '//x:A' },
	'a prefix the resolver lacks, after a step selecting nothing → refused': {
		expression: '//default:Missing/x:A',
	},
	'a prefix the resolver lacks, after an axis → refused': {
		expression: '//default:AA_1/following-sibling::x:AA_1',
	},
	'the document level: no XML declaration, no text, the comment and the root': {
		expression: 'count(/node())',
	},
	'the document level: the root at its place': { expression: '/default:Root' },
	'an element of another default namespace': { expression: '//*[local-name() = "F"]' },
	'xmlns attributes are no attributes: @*': { expression: '//default:Root/@*' },
	'xmlns attributes are no attributes: count(@*)': { expression: 'count(//default:Root/@*)' },
	'xmlns attributes are no attributes: not(@*)': { expression: '//default:D[not(@*)]' },
	'an element whose only attribute is a declaration: not(@*)': {
		expression: '//*[local-name() = "E"][not(@*)]',
	},
	'a prefixed attribute on the attribute axis': { expression: '//default:A/@*' },
	'whitespace-only text nodes': { expression: 'count(//default:Root/text())' },
	'whitespace-only text nodes, selected': {
		expression: '//default:Root/text()[normalize-space() = ""]',
	},
	'an entity in an attribute value': { expression: '//default:A[@aA = "x & y"]' },
	'CDATA as text': { expression: '//default:B[. = "a<b"]' },
	'entities and a character reference as text': { expression: 'string(//default:C)' },
	'nested predicates': { expression: '//default:Root[default:A[e:AA_3[@e:aAA_3 = "3"]]]' },
	'a predicate on a child': { expression: '//default:A[default:AA_1[@aAA_1 = "2"]]' },
	'count()': { expression: 'count(//default:AA_1)' },
	'contains()': { expression: '//default:A[contains(@aA, "&")]' },
	'local-name()': { expression: '//*[local-name() = "AA_3"]' },
	'name() keeps the document prefix': { expression: 'name(//e:AA_3)' },
	'following-sibling:: with a name': {
		expression: '//default:AA_1[@aAA_1 = "1"]/following-sibling::default:AA_1',
	},
	'following-sibling::*': { expression: '//default:AA_1[@aAA_1 = "2"]/following-sibling::*' },
	'a union, in document order': { expression: '//default:D | //default:B' },
	'a union, its first': { expression: '(//default:D | //default:B)[1]' },
	'[1] per parent': { expression: '//default:AA_1[1]' },
	'[last()] per parent': { expression: '//default:AA_1[last()]' },
	'[last()] of the whole set': { expression: '(//default:AA_1)[last()]' },
	'a missing last step': { expression: '//default:A[@aA = "x & y"]/default:AA_1[@aAA_1 = "3"]' },
	'a missing middle step': { expression: '//default:Root/default:Z/default:AA_1' },
	'two attributes of one local name in different namespaces: the attribute axis': {
		expression: '//default:G/@*',
	},
	'two attributes of one local name in different namespaces: each told apart by its namespace': {
		expression: '//default:G[@e:v = "1" and @f:v = "2"]/@f:v',
	},
}

runTestCases.generic(testCases, function act(testCase) {
	const { expression } = testCase
	expect(answerOfSeam({ expression })).toEqual(answerOfPage({ expression }))
	expect(firstEmptyStep({ expression, answer: answerOfSeam })).toBe(
		firstEmptyStep({ expression, answer: answerOfPage }),
	)
})
