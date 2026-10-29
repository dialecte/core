import { localNameOf } from './local-name-of'
import { ATTRIBUTE_NODE_TYPE } from './xml-dom.constants'

import type { NodePlace, XmlDomAttribute, XmlNode } from './xml-dom.types'

/** Where a node sits from its document (see `NodePlace`). */
export function placeOfNode(params: { node: XmlNode }): NodePlace {
	const { node } = params
	const attributeNode =
		node.nodeType === ATTRIBUTE_NODE_TYPE ? (node as XmlDomAttribute) : undefined
	const attribute = attributeNode
		? { namespaceUri: attributeNode.namespaceURI, localName: localNameOf({ node: attributeNode }) }
		: undefined
	const childIndices: number[] = []
	let current: XmlNode | null = attributeNode ? attributeNode.ownerElement : node
	while (current?.parentNode) {
		childIndices.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes, current))
		current = current.parentNode
	}
	return attribute ? { childIndices, attribute } : { childIndices }
}
