import { describePlace } from './describe-place'
import { findUnboundPrefix } from './find-unbound-prefix'
import { nodeAtPlace } from './node-at-place'
import { placeOfNode } from './place-of-node'

import * as xpath from 'xpath'

import type { NamespaceResolver, XPathDocument, XPathValue } from './xml-dom.types'

/**
 * Evaluate an XPath 1.0 expression on a document: on its view without namespace declaration attributes, the nodes
 * it selects answered as the original document's nodes, in document order.
 */
export function evaluateXPath(params: {
	expression: string
	xpathDocument: XPathDocument
	namespaceResolver: NamespaceResolver
}): XPathValue {
	const { expression, xpathDocument, namespaceResolver } = params
	const unboundPrefix = findUnboundPrefix({ expression, namespaceResolver })
	if (unboundPrefix !== undefined) {
		throw new Error(`XPath "${expression}": the prefix "${unboundPrefix}" is bound to no namespace`)
	}
	const resolver = {
		lookupNamespaceURI: function resolvePrefix(prefix: string | null) {
			return prefix === null ? null : namespaceResolver(prefix)
		},
	}
	const value = xpath.selectWithResolver(
		expression,
		xpathDocument.view as unknown as Node,
		resolver,
	)
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value
	}
	const nodes = Array.isArray(value) ? value : value === null ? [] : [value]
	return nodes.map(function originalOf(node) {
		const place = placeOfNode({ node })
		const original = nodeAtPlace({ root: xpathDocument.original, place })
		if (original === undefined) {
			throw new Error(
				`XPath "${expression}": the copy XPath reads selected a node with no node at ${describePlace({ place })} in the original document`,
			)
		}
		return original
	})
}
