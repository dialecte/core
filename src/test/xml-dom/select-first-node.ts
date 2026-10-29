import { evaluateXPath } from './evaluate-xpath'

import type { NamespaceResolver, XmlNode, XPathDocument } from './xml-dom.types'

/**
 * The first node, in document order, an XPath expression selects; `undefined` for none. An expression that
 * answers no node set (a count, a string) is refused.
 */
export function selectFirstNode(params: {
	expression: string
	xpathDocument: XPathDocument
	namespaceResolver: NamespaceResolver
}): XmlNode | undefined {
	const { expression } = params
	const value = evaluateXPath(params)
	if (!Array.isArray(value)) {
		throw new Error(
			`XPath "${expression}" selects no node set: it answers ${JSON.stringify(value)}`,
		)
	}
	return value[0]
}
