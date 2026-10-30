import type { XmlNamespaces, XmlNode } from '../xml'
import type { Namespace } from '@/types'

/** XPath queries on XML text; prefixes are the dialecte config's namespace keys. */
export type XmlQueriesParams = { xml: string; queries: string[] }

/** XPath queries on XML text, with the namespaces their prefixes stand for: without them no prefix resolves. */
export type XmlQueriesWithNamespacesParams = XmlQueriesParams & {
	namespaces?: Record<string, Namespace>
}

/** The expected then the unexpected queries of one XML text, on one parse of it. */
export type XmlQueryChecks = {
	xml: string
	namespaces: XmlNamespaces
	expectedQueries?: string[]
	unexpectedQueries?: string[]
}

/** A query's progressive steps run in order until one selects nothing. */
export type QueryTrace = {
	steps: string[]
	/** How many steps selected a node before the first that selected none. */
	matchedSteps: number
	/** The first node the last matching step selected. */
	lastMatch: XmlNode | undefined
}

/** A location step of an XPath, read for a failure message. */
export type XpathStepReading = {
	/** The step as written, its predicates left out (`//default:A[@aA="1"]` → `//default:A`). */
	withoutPredicates: string
	/** The separator before the step: `/`, `//`, or nothing for a relative first step. */
	separator: string
	/** The axis written before the name test (`following-sibling`); undefined for the abbreviated ones. */
	axis: string | undefined
	/** The name test as a qualified name; undefined when the step tests no name (`*`, `node()`, `..`). */
	name: { prefix: string | undefined; localName: string } | undefined
	/** The attributes the predicates name (`@aA`, `@ext:aAA_3`), as written. */
	predicateAttributes: string[]
}
