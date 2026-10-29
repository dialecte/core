import { parseXml } from './parse-xml'
import { removeNamespaceDeclarations } from './remove-namespace-declarations'
import { serializeXmlNode } from './serialize-xml-node'

import * as xmlDom from '@xmldom/xmldom'

import type { XmlDomDocument, XmlNode, XPathDocument } from './xml-dom.types'

/**
 * The document XPath reads for `original`, its namespace declaration attributes removed (the namespaces of its
 * nodes stay what they are): a deep clone of a pure-JS DOM document, or a page's document parsed again from its
 * serialization.
 */
export function createXPathDocument(params: { original: XmlNode }): XPathDocument {
	const { original } = params
	const view = copyForXPath({ original })
	if (view.documentElement) removeNamespaceDeclarations({ element: view.documentElement })
	return { view, original }
}

function copyForXPath(params: { original: XmlNode }): XmlDomDocument {
	const { original } = params
	if (original instanceof xmlDom.Document) return original.cloneNode(true) as XmlDomDocument
	const parsed = parseXml({ xml: serializeXmlNode({ node: original }) })
	if ('error' in parsed) throw new Error(`malformed XML — ${parsed.error}`)
	return parsed.document
}
