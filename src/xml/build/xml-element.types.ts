/**
 * An attribute as a DOM element holds it: its namespace, the prefix it was set with, its local name (the whole name
 * for an attribute set without a namespace) and its value.
 */
export type XmlAttribute = {
	namespaceURI: string | null
	prefix: string | null
	localName: string
	value: string
}

/**
 * An element as the writer models it: what the DOM builder set on it, in the order it set it, and its parent. The
 * namespace lookups and the serializer read it the way a DOM element is read; no DOM is needed.
 */
export type XmlElement = {
	namespaceURI: string | null
	prefix: string | null
	localName: string
	attributes: XmlAttribute[]
	parent: XmlElement | undefined
}

/**
 * The prefixes bound where an element stands (`''` = the default namespace): the bindings an element added, then its
 * ancestors' scope. An element that binds nothing shares its parent's scope.
 */
export type NamespaceScope = {
	readonly bindings: ReadonlyMap<string, string>
	readonly parent: NamespaceScope | undefined
}

/** The number of the next prefix the serializer generates (`ns<k>`) for an attribute whose prefix is taken. */
export type GeneratedPrefixes = { next: number }
