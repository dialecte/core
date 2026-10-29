import type * as xmlDom from '@xmldom/xmldom'

/** A prefixed namespace declaration (`xmlns:p`); its value may not be empty in XML namespaces 1.0. */
export const EMPTY_PREFIX_BINDING_PATTERN = /^xmlns:./

/** The namespace of namespace declarations: on the attribute axis of XPath 1.0 they are not attributes. */
export const XMLNS_NAMESPACE_URI = 'http://www.w3.org/2000/xmlns/'

/** `nodeType` of an attribute node. */
export const ATTRIBUTE_NODE_TYPE = 2

/** A string literal of an XPath expression, `'…'` or `"…"`: what it holds is no prefix. */
export const XPATH_STRING_LITERAL_PATTERN = /'[^']*'|"[^"]*"/g

/** What separates an axis from its name test (`following-sibling::p:name`): set apart before prefixes are read. */
export const XPATH_AXIS_SEPARATOR = '::'

/** A prefix of an XPath name test, `p:name` or `p:*`, once the axis separators are set apart. */
export const XPATH_PREFIX_PATTERN = /(?<![\w.:$-])([A-Za-z_][\w.-]*):(?!:)(?=[A-Za-z_*])/g

/** What the pure-JS DOM keeps at the document level and the DOM does not: the XML declaration, the text around the root. */
export const DOCUMENT_LEVEL_NODES_OUTSIDE_THE_DATA_MODEL: readonly ((
	node: xmlDom.Node,
) => boolean)[] = [
	(node) => node.nodeType === 7 && node.nodeName === 'xml',
	(node) => node.nodeType === 3,
]
