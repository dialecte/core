import type { NamespaceScope } from './xml-element.types'

/** The XML declaration every written document starts with, unless asked without one. */
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'

/** The namespace of the `xml:` prefix, bound everywhere without a declaration. */
export const XML_NAMESPACE_URI = 'http://www.w3.org/XML/1998/namespace'

/** The line break of the formatted layout. */
export const LINE_SEPARATOR = '\r\n'

/** One level of indentation of the formatted layout. */
export const INDENTATION = '    '

/** The characters `XMLSerializer` escapes in an attribute value, and in a text value. */
export const ATTRIBUTE_ESCAPED = /[&<>"\t\n\r]/
export const ATTRIBUTE_ESCAPED_ALL = /[&<>"\t\n\r]/g
export const TEXT_ESCAPED = /[&<>]/
export const TEXT_ESCAPED_ALL = /[&<>]/g
/** In the compact layout a text value's carriage return is escaped too. */
export const COMPACT_TEXT_ESCAPED = /[&<>\r]/
export const COMPACT_TEXT_ESCAPED_ALL = /[&<>\r]/g

/** The reference each escaped character is written as. */
export const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	'\t': '&#9;',
	'\n': '&#10;',
	'\r': '&#13;',
}

/** Where the written root stands: nothing bound. */
export const EMPTY_SCOPE: NamespaceScope = { bindings: new Map(), parent: undefined }

/** No prefix: what an element that generates none answers, shared. */
export const NO_PREFIXES: ReadonlySet<string> = new Set()
