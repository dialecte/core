import type { NodePlace, XmlNode } from './xml-dom.types'

/** The node of `root`'s document at `place` (see `NodePlace`); `undefined` when it holds none there. */
export function nodeAtPlace(params: { root: XmlNode; place: NodePlace }): XmlNode | undefined {
	const { root, place } = params
	let current: XmlNode | undefined = root
	for (const index of place.childIndices) {
		current = current?.childNodes[index] as XmlNode | undefined
	}
	if (!place.attribute || !current) return current
	const { namespaceUri, localName } = place.attribute
	const element = current as XmlNode & {
		getAttributeNodeNS: (uri: string | null, name: string) => XmlNode | null
	}
	return element.getAttributeNodeNS(namespaceUri, localName) ?? undefined
}
