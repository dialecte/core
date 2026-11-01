import { XmlQueryRefusedError, selectFirstNode, withXmlDocument } from '../xml'
import { FAILURE_HEADERS, QUERIED_XML_LABEL } from './assert-xml.constants'
import {
	describeMissingElement,
	describeRefusedQuery,
	describeUnexpectedElement,
} from './query-failure-message'
import { splitXpathIntoSteps } from './xpath-parser'

import type { XmlDocument, XmlNamespaces, XmlNode } from '../xml'
import type {
	QueryTrace,
	XmlAssertions,
	XmlQueriesParams,
	XmlQueriesWithNamespacesParams,
	XmlQueryChecks,
} from './assert-xml.types'
import type { Namespace } from '@/types'

/**
 * The query assertions of a dialecte: XPath prefixes are its config's namespace keys, mapped to their URIs
 * once here. Made once per dialecte (e.g. in scl's test entry) and offered beside `createTestProject`.
 *
 * @intent make XPath assertions bound to a dialecte's namespaces, assert exported XML in tests
 */
export function createXmlAssertions(params: {
	namespaces: Record<string, Namespace>
}): XmlAssertions {
	const namespaces = toXmlNamespaces(params.namespaces)
	return {
		assertExpectedElementQueries(params: XmlQueriesParams) {
			assertXmlQueries({ xml: params.xml, namespaces, expectedQueries: params.queries })
		},
		assertUnexpectedElementQueries(params: XmlQueriesParams) {
			assertXmlQueries({ xml: params.xml, namespaces, unexpectedQueries: params.queries })
		},
	}
}

/**
 * Asserts that each XPath query selects at least one node of the XML text, parsed once for all of them.
 * A failure names the steps that matched, the step that failed, where the last match sits, what the failing
 * step finds there without its predicates, and the XML around it.
 *
 * @intent assert that XML holds the elements XPath queries select, check that an export holds an element
 */
export function assertExpectedElementQueries(params: XmlQueriesWithNamespacesParams): void {
	const { xml, queries, namespaces = {} } = params
	assertXmlQueries({ xml, namespaces: toXmlNamespaces(namespaces), expectedQueries: queries })
}

/**
 * Asserts that no XPath query selects a node of the XML text, parsed once for all of them.
 *
 * Every step but the last must still select a node: an absence is only meaningful when the ancestors
 * exist, so a missing ancestor (a fixture bug) fails the assertion instead of passing it for the wrong
 * reason.
 *
 * @intent assert that XML does not hold an element, check that an element was removed from an export
 */
export function assertUnexpectedElementQueries(params: XmlQueriesWithNamespacesParams): void {
	const { xml, queries, namespaces = {} } = params
	assertXmlQueries({ xml, namespaces: toXmlNamespaces(namespaces), unexpectedQueries: queries })
}

/** The expected then the unexpected queries of one text, on one parse of it. */
export function assertXmlQueries(params: XmlQueryChecks): void {
	const { xml, namespaces, expectedQueries = [], unexpectedQueries = [] } = params
	withXmlDocument({ xml, label: QUERIED_XML_LABEL }, function assertOnDocument(document) {
		for (const query of expectedQueries) assertExpectedQuery({ document, namespaces, query })
		for (const query of unexpectedQueries) assertUnexpectedQuery({ document, namespaces, query })
	})
}

/** XPath prefix to namespace URI, from a config's namespaces. */
export function toXmlNamespaces(namespaces: Record<string, Namespace>): XmlNamespaces {
	return Object.fromEntries(
		Object.entries(namespaces).map(([prefix, namespace]) => [prefix, namespace.uri]),
	)
}

function assertExpectedQuery(params: {
	document: XmlDocument
	namespaces: XmlNamespaces
	query: string
}): void {
	const { document, namespaces, query } = params
	if (selectQueryNode({ document, namespaces, query })) return
	const trace = traceQuerySteps({ document, namespaces, query, stepCount: undefined })
	throw new Error(
		describeMissingElement({
			header: FAILURE_HEADERS.expectedNotFound,
			query,
			trace,
			document,
			namespaces,
		}),
	)
}

function assertUnexpectedQuery(params: {
	document: XmlDocument
	namespaces: XmlNamespaces
	query: string
}): void {
	const { document, namespaces, query } = params
	const node = selectQueryNode({ document, namespaces, query })
	if (node) throw new Error(describeUnexpectedElement({ query, node }))
	const ancestorSteps = splitXpathIntoSteps(query).length - 1
	const trace = traceQuerySteps({ document, namespaces, query, stepCount: ancestorSteps })
	if (trace.matchedSteps === ancestorSteps) return
	throw new Error(
		describeMissingElement({
			header: `${FAILURE_HEADERS.unreliable}: step ${trace.matchedSteps + 1} of ${trace.steps.length} matches nothing, so the absence proves nothing`,
			query,
			trace,
			document,
			namespaces,
		}),
	)
}

/** The first node the whole query selects; a query the engine refuses fails with why. */
function selectQueryNode(params: {
	document: XmlDocument
	namespaces: XmlNamespaces
	query: string
}): XmlNode | undefined {
	const { document, namespaces, query } = params
	try {
		return selectFirstNode({ context: document, expression: query, namespaces })
	} catch (error) {
		if (!(error instanceof XmlQueryRefusedError)) throw error
		throw new Error(describeRefusedQuery({ query, reason: error.reason }))
	}
}

/**
 * Runs the query's progressive steps in order, the first `stepCount` of them (all when undefined), until one
 * selects nothing. A step the engine refuses on its own counts as selecting nothing: the whole query compiled.
 */
function traceQuerySteps(params: {
	document: XmlDocument
	namespaces: XmlNamespaces
	query: string
	stepCount: number | undefined
}): QueryTrace {
	const { document, namespaces, query, stepCount } = params
	const steps = splitXpathIntoSteps(query)
	let lastMatch: XmlNode | undefined
	let matchedSteps = 0
	for (const step of steps.slice(0, stepCount ?? steps.length)) {
		const node = selectStepNode({ document, namespaces, step })
		if (!node) break
		lastMatch = node
		matchedSteps += 1
	}
	return { steps, matchedSteps, lastMatch }
}

function selectStepNode(params: {
	document: XmlDocument
	namespaces: XmlNamespaces
	step: string
}): XmlNode | undefined {
	const { document, namespaces, step } = params
	try {
		return selectFirstNode({ context: document, expression: step, namespaces })
	} catch (error) {
		if (error instanceof XmlQueryRefusedError) return undefined
		throw error
	}
}
