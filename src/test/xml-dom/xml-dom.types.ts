import type * as xmlDom from '@xmldom/xmldom'

/** A document of the pure-JS XML DOM the test entry parses with. */
export type XmlDomDocument = xmlDom.Document

/** An element of the pure-JS XML DOM. */
export type XmlDomElement = xmlDom.Element

/** An attribute of the pure-JS XML DOM. */
export type XmlDomAttribute = xmlDom.Attr

/** A node to query or print: from the pure-JS XML DOM, or a page's DOM (`project.export({ xmlDocument: true })`). */
export type XmlNode = xmlDom.Node | Node

/** The namespace URI an XPath prefix stands for; `null` for a prefix it does not know. */
export type NamespaceResolver = (prefix: string) => string | null

/** XML text parsed: its document, or why it is not well-formed. */
export type ParsedXml = { document: XmlDomDocument } | { error: string }

/**
 * A document as XPath reads it: `view`, a twin of `original` without namespace declaration attributes (in XPath 1.0
 * they are namespace nodes, not attributes), the nodes it selects mapped back to `original` by their place.
 */
export type XPathDocument = { view: XmlDomDocument; original: XmlNode }

/** Where a node sits from its document: the child index at each level, and the attribute for an attribute node. */
export type NodePlace = {
	childIndices: number[]
	attribute?: { namespaceUri: string | null; localName: string }
}

/** What an XPath expression evaluates to: its nodes in document order, or a string, a number or a boolean. */
export type XPathValue = XmlNode[] | string | number | boolean
