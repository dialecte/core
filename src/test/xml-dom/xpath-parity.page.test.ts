import { splitXpathIntoSteps } from '../assert-xml/xpath-parser'
import { runTestCases } from '../run-test-cases'
import { createXPathDocument } from './create-xpath-document'
import { describePlace } from './describe-place'
import { evaluateXPath } from './evaluate-xpath'
import { parseXml } from './parse-xml'
import { placeOfNode } from './place-of-node'
import { serializeXmlNode } from './serialize-xml-node'
import { ATTRIBUTE_NODE_TYPE } from './xml-dom.constants'

import { expect } from 'vitest'

import type { BaseTestCase } from '../run-test-cases.type'
import type { XmlNode } from './xml-dom.types'

// The test entry's XPath (the pure-JS DOM and the `xpath` package) against the page's (DOMParser and
// document.evaluate), on the expressions where two XPath engines part most easily. Both must answer the same:
// the same value, the same nodes at the same places printed the same, the same step where an expression stops.

const NAMESPACES: Record<string, string> = { default: 'urn:d', e: 'urn:e' }

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
	'</Root>',
].join('\n')

/** What an engine answers: a value, the nodes (place + serialization), or that it refused the expression. */
type EngineAnswer =
	| { value: string | number | boolean }
	| { nodes: { place: string; xml: string }[] }
	| { refused: true }

type TestCase = BaseTestCase & { expression: string }

/**
 * A node as both engines are compared on: its place from the root, and its XML printed by one serializer for both
 * (the serializers differ in where they write a namespace declaration, not in the node); an attribute as `name="value"`.
 */
function describeNode(params: { node: XmlNode }): { place: string; xml: string } {
	const { node } = params
	const place = describePlace({ place: placeOfNode({ node }) })
	if (node.nodeType === ATTRIBUTE_NODE_TYPE) {
		const attribute = node as Attr
		return { place, xml: `${attribute.name}="${attribute.value}"` }
	}
	return { place, xml: serializeXmlNode({ node }) }
}

function resolvePrefix(prefix: string | null): string | null {
	return prefix === null ? null : (NAMESPACES[prefix] ?? null)
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
			describeNode({ node: snapshot.snapshotItem(index)! }),
		)
		return { nodes }
	} catch {
		return { refused: true }
	}
}

/** The test entry's answer: the pure-JS DOM + the `xpath` package. */
function answerOfTestEntry(params: { expression: string }): EngineAnswer {
	const { expression } = params
	const parsed = parseXml({ xml: DOCUMENT_XML })
	if ('error' in parsed) throw new Error(parsed.error)
	const xpathDocument = createXPathDocument({ original: parsed.document })
	try {
		const value = evaluateXPath({ expression, xpathDocument, namespaceResolver: resolvePrefix })
		if (!Array.isArray(value)) return { value }
		return {
			nodes: value.map((node) => describeNode({ node })),
		}
	} catch {
		return { refused: true }
	}
}

/** The first step of the expression that selects nothing, by an engine; `-1` when every step selects a node. */
function firstEmptyStep(params: {
	expression: string
	answer: (params: { expression: string }) => EngineAnswer
}): number {
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
}

runTestCases.generic(testCases, function act(testCase) {
	const { expression } = testCase
	const page = answerOfPage({ expression })
	const testEntry = answerOfTestEntry({ expression })
	expect(testEntry).toEqual(page)
	expect(firstEmptyStep({ expression, answer: answerOfTestEntry })).toBe(
		firstEmptyStep({ expression, answer: answerOfPage }),
	)
})
