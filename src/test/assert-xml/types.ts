import type { XmlDomDocument } from '../xml-dom'

/**
 * The XML the queries run on: its text (parsed by the assertion), or a document already parsed - the pure-JS
 * XML DOM's, or a page's (`project.export({ xmlDocument: true })`).
 */
export type XmlQueryTarget = { xml: string } | { xmlDocument: XmlDomDocument | Document }

/** XPath queries on an XML document; prefixes are the dialecte config's namespace keys. */
export type XmlQueriesParams = XmlQueryTarget & { queries: string[] }

/** The namespace URI an XPath prefix stands for; `null` for a prefix it does not know. */
export type NsResolver = (prefix: string | null) => string | null

export type XmlQueriesWithResolverParams = XmlQueriesParams & {
	nsResolver?: NsResolver
}
