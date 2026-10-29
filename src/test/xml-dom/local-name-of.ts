import type { XmlDomAttribute, XmlDomElement } from './xml-dom.types'

/**
 * The local name of an element or an attribute. Both always have one; the pure-JS XML DOM types it nullable
 * because other kinds of node have none.
 */
export function localNameOf(params: { node: XmlDomElement | XmlDomAttribute }): string {
	const { node } = params
	return node.localName ?? node.nodeName
}
