import type { NamespaceScope, XmlElement } from './xml-element.types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

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
