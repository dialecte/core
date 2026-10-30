import { XmlAttribute, XmlCData, XmlComment, XmlElement, XmlText } from '../xml'
import { LAST_KEPT_LINE } from './assert-xml.constants'

import type { XmlNode } from '../xml'

/**
 * Where a node sits: its positional path from the root (`/Root[1]/A[2]/ext:B[1]`, `.../text()[1]`, each step
 * counted among the siblings of the same name and namespace, or of the same kind) and its line, as a message
 * says it (`line 12`; `line ≥ 65535` past the last line the engine keeps).
 */
export function describeNodePlace(node: XmlNode): { path: string; line: string } {
	if (node instanceof XmlElement) {
		return { path: positionalPathOf(node), line: formatLine(node.line) }
	}
	const owner = node.parent
	if (!owner) return { path: '/', line: formatLine(0) }
	return { path: `${positionalPathOf(owner)}/${stepOf(node)}`, line: formatLine(owner.line) }
}

/** The element's name as the document writes it: `prefix:name`, or `name` in the default namespace. */
export function qualifiedNameOf(node: XmlElement | XmlAttribute): string {
	return node.prefix ? `${node.prefix}:${node.name}` : node.name
}

/** A line as a message says it: the engine keeps a line up to 65535, a later one reads as that bound. */
export function formatLine(line: number): string {
	return line >= LAST_KEPT_LINE ? `line ≥ ${LAST_KEPT_LINE}` : `line ${line}`
}

/** The last step of a node that is not an element: `@name`, `text()[n]`, `comment()[n]`, else `node()`. */
function stepOf(node: XmlNode): string {
	if (node instanceof XmlAttribute) return `@${qualifiedNameOf(node)}`
	if (isTextNode(node)) return `text()[${positionAmongKind({ node, isSameKind: isTextNode })}]`
	if (node instanceof XmlComment) {
		return `comment()[${positionAmongKind({ node, isSameKind: isComment })}]`
	}
	return 'node()'
}

function isTextNode(node: XmlNode): boolean {
	return node instanceof XmlText || node instanceof XmlCData
}

function isComment(node: XmlNode): boolean {
	return node instanceof XmlComment
}

/** 1 + the preceding siblings of the same kind (text and CDATA are both text, as XPath reads them). */
function positionAmongKind(params: {
	node: XmlNode
	isSameKind: (node: XmlNode) => boolean
}): number {
	const { node, isSameKind } = params
	let position = 1
	if (!(node instanceof XmlText || node instanceof XmlCData || node instanceof XmlComment)) {
		return position
	}
	for (let sibling = node.prev; sibling; sibling = sibling.prev) {
		if (isSameKind(sibling)) position += 1
	}
	return position
}

function positionalPathOf(element: XmlElement): string {
	const steps: string[] = []
	for (let current: XmlElement | null = element; current; current = current.parent) {
		steps.unshift(`${qualifiedNameOf(current)}[${positionAmongNamesakes(current)}]`)
	}
	return `/${steps.join('/')}`
}

/** 1 + the preceding siblings with the same name and namespace. */
function positionAmongNamesakes(element: XmlElement): number {
	let position = 1
	for (let sibling = element.prev; sibling; sibling = sibling.prev) {
		if (
			sibling instanceof XmlElement &&
			sibling.name === element.name &&
			sibling.namespaceUri === element.namespaceUri
		) {
			position += 1
		}
	}
	return position
}
