import type { NamespaceScope, XmlElement } from './xml-element.types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

/**
 * Writes records as XML text, element by element in document order. The root start tag is only complete once every
 * element is written: the body comes as it goes (`take`), the head (declaration and root start tag) at the end (`head`).
 */
export type XmlWriter = {
	/** Open the element of the next record in document order (the first is the written root). */
	openElement: (params: { record: AnyRawRecord }) => void
	/** Close the element opened last. */
	closeElement: () => void
	/** The body written since the last call: what follows the root start tag. */
	take: () => string
	/** The XML declaration and the root start tag, complete once the root is closed. */
	head: () => string
}

export type XmlWriterParams = {
	config: AnyDialecteConfig
	/**
	 * The document's root record, when the record written first is the document root; absent for a fragment, which
	 * gets no root attributes.
	 */
	documentRoot?: AnyRawRecord
	/** Formatted (4 spaces, CRLF, a text value on its element's line); `false` = compact. Default `true`. */
	indent?: boolean
	/** Declare namespaces (`xmlns`, `xmlns:*`); `false` writes prefixed names literally, a bare fragment. Default `true`. */
	declareNamespaces?: boolean
	/** Start with the XML declaration. Default `true`. */
	includeXmlDeclaration?: boolean
	/** The record id as `_temp-idb-id` on every element. Default `false`. */
	withDatabaseIds?: boolean
}

/** An element the writer has opened and not yet closed. */
export type OpenElement = {
	element: XmlElement
	qualifiedName: string
	/** Its depth: the root is at 0. */
	level: number
	/** The scope its children stand in. */
	scope: NamespaceScope
	/** Written with neither text nor children: `/>`. */
	empty: boolean
	/** Its content is written inline, as the formatter keeps it: no line breaks or indentation below it. */
	inline: boolean
	/** It stands inside an inline element. */
	insideInline: boolean
}

/** A record's element just opened, and what the writer writes of it. */
export type OpenedRecord = {
	opened: OpenElement
	/** Its start tag, without its closing `>` or `/>`; none for the root, written at the end. */
	startTag: string | undefined
	/** Its text value, trimmed of XML whitespace; `''` when none. */
	text: string
}
