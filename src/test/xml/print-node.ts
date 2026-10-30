import { XmlAttribute, XmlElement } from './engine'
import { DEFAULT_PRINT_MAX_LINES, PRINT_INDENT } from './xml.constants'

import { formatXml } from '@/utils/format-xml'

import type { XmlNode } from './xml.types'

/** A node as indented XML, cut after `maxLines` lines with `… (<n> more lines)`. */
export function printNode(params: { node: XmlNode; maxLines?: number }): string {
	const { node, maxLines = DEFAULT_PRINT_MAX_LINES } = params
	const lines = formatXml(serializeNode(node), { indent: PRINT_INDENT }).split('\n')
	if (lines.length <= maxLines) return lines.join('\n')
	const leftOut = lines.length - maxLines
	return [...lines.slice(0, maxLines), `… (${leftOut} more lines)`].join('\n')
}

/** The node's own XML: an element with its subtree, an attribute as `name="value"`, else its text. */
function serializeNode(node: XmlNode): string {
	if (node instanceof XmlElement) return node.toString({ format: false })
	if (node instanceof XmlAttribute) {
		const name = node.prefix ? `${node.prefix}:${node.name}` : node.name
		return `${name}="${node.value}"`
	}
	return node.content
}
