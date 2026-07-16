import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

export type BuildXmlDocumentParams = {
	records: AnyRawRecord[]
	config: AnyDialecteConfig
	withDatabaseIds?: boolean
	/**
	 * Build a fragment rooted at this record id instead of the document root
	 * (`config.rootElementName`). When the resolved record is not the document
	 * root, root-only attribute enforcement is skipped so a scoped fragment
	 * (e.g. a lone `LN`) is not stamped with document-root attributes.
	 */
	rootId?: string
	/**
	 * Emit namespace declarations (`xmlns` / `xmlns:*`). Defaults to `true`.
	 * Set `false` to render a bare fragment whose elements keep their literal
	 * (possibly prefixed) tag names but carry no namespace declarations — so a
	 * scoped snapshot reads like an excerpt nested in its file rather than a
	 * standalone document.
	 */
	declareNamespaces?: boolean
}
