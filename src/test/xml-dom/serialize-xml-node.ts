import * as xmlDom from '@xmldom/xmldom'

import type { XmlNode } from './xml-dom.types'

/** A node as XML text, with the namespace declarations it needs. */
export function serializeXmlNode(params: { node: XmlNode }): string {
	const { node } = params
	return new xmlDom.XMLSerializer().serializeToString(node as xmlDom.Node)
}
