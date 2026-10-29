import { createXPathDocument, parseXml, selectFirstNode, serializeXmlNode } from '../xml-dom'
import { splitXpathIntoSteps } from './xpath-parser'

import { expect } from 'vitest'

import { formatXml as formatXmlSource } from '@/utils/format-xml'

import type { XmlNode, XPathDocument } from '../xml-dom'
import type {
	NsResolver,
	XmlQueriesParams,
	XmlQueriesWithResolverParams,
	XmlQueryTarget,
} from './types'
import type { Namespace } from '@/types'

/**
 * Creates a pair of assertion functions pre-configured with a namespace resolver
 * derived from a prefix → URI map. Intended to be instantiated once per dialecte
 * (e.g. in scl test) and re-exported alongside createTestProject.
 */
export function createXmlAssertions(params: { namespaces: Record<string, Namespace> }) {
	const { namespaces } = params
	const nsResolver = buildNsResolver(namespaces)

	return {
		assertExpectedElementQueries(params: XmlQueriesParams) {
			assertExpectedElementQueries({ ...params, nsResolver })
		},
		assertUnexpectedElementQueries(params: XmlQueriesParams) {
			assertUnexpectedElementQueries({ ...params, nsResolver })
		},
	}
}
/**
 * Assert that each XPath query matches at least one element in the document.
 * When a query fails, the error message shows which step failed
 * and the XML of the last successful match for debugging.
 */
export function assertExpectedElementQueries(params: XmlQueriesWithResolverParams) {
	const { queries, nsResolver = resolveNoPrefix } = params
	const xpathDocument = resolveXPathDocument(params)
	for (const query of queries) {
		assertExpectedXPath({ xpathDocument, xpath: query, nsResolver })
	}
}

/** Builds a namespace resolver from a map of XPath prefix (a config namespace key) to namespace. */
function buildNsResolver(namespaces: Record<string, Namespace>): NsResolver {
	return function resolveConfigPrefix(prefix: string | null) {
		return prefix ? (namespaces[prefix]?.uri ?? null) : null
	}
}

/** Without a dialecte's namespaces, no prefix resolves. */
function resolveNoPrefix(): null {
	return null
}

/** The document the queries run on, as XPath reads it: the one given, or the text parsed. */
function resolveXPathDocument(target: XmlQueryTarget): XPathDocument {
	if ('xmlDocument' in target) return createXPathDocument({ original: target.xmlDocument })
	const parsed = parseXml({ xml: target.xml })
	if ('error' in parsed) throw new Error(`malformed XML — ${parsed.error}`)
	return createXPathDocument({ original: parsed.document })
}

/**
 * Assert that each XPath query does NOT match any element in the document.
 *
 * Progressive evaluation: all steps except the last one MUST exist
 * (to confirm the assertion is meaningful), and only the final step
 * must be absent. This prevents false positives where the query passes
 * because an ancestor doesn't exist (test setup bug) rather than the
 * target element being properly absent.
 *
 * For single-step queries, the full XPath is simply asserted as absent.
 */
export function assertUnexpectedElementQueries(params: XmlQueriesWithResolverParams) {
	const { queries, nsResolver = resolveNoPrefix } = params
	const xpathDocument = resolveXPathDocument(params)
	for (const query of queries) {
		assertUnexpectedXPath({ xpathDocument, xpath: query, nsResolver })
	}
}

function assertExpectedXPath(params: {
	xpathDocument: XPathDocument
	xpath: string
	nsResolver: NsResolver
}) {
	const { xpathDocument, xpath, nsResolver } = params
	const steps = splitXpathIntoSteps(xpath)

	let prevElement: XmlNode | undefined
	let lastSuccessfulStep = 0

	for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
		const stepXpath = steps[stepIndex]
		const element = selectFirstNode({
			expression: stepXpath,
			xpathDocument,
			namespaceResolver: nsResolver,
		})

		if (element) {
			prevElement = element
			lastSuccessfulStep = stepIndex + 1
			continue
		}

		const failedSegment = stepIndex === 0 ? steps[0] : xpath.slice(steps[stepIndex - 1].length)

		const contextInfo =
			lastSuccessfulStep === 0
				? `[No parent matched — failed from document root]\n  Document:\n${formatNode({ node: xpathDocument.original })}`
				: `[Last match at step ${lastSuccessfulStep}/${steps.length}]:\n${prevElement ? formatNode({ node: prevElement }) : '(none)'}`

		expect(
			element,
			`Element not found in XML.\n` +
				`  Failed at step ${stepIndex + 1}/${steps.length}: ${failedSegment.trim()}\n` +
				`  Full XPath: ${xpath}\n` +
				`  ${contextInfo}`,
		).toBeTruthy()

		return
	}
}

/** A failure message's XML, indented by depth for reading. */
function formatNode(params: { node: XmlNode }): string {
	return formatXmlSource(serializeXmlNode(params), { indent: '  ' })
}

function assertUnexpectedXPath(params: {
	xpathDocument: XPathDocument
	xpath: string
	nsResolver: NsResolver
}) {
	const { xpathDocument, xpath, nsResolver } = params
	const steps = splitXpathIntoSteps(xpath)

	// For multi-step queries, verify all steps except the last one DO exist
	// This ensures the absence assertion is meaningful
	if (steps.length > 1) {
		let prevElement: XmlNode | undefined

		for (let stepIndex = 0; stepIndex < steps.length - 1; stepIndex++) {
			const stepXpath = steps[stepIndex]
			const element = selectFirstNode({
				expression: stepXpath,
				xpathDocument,
				namespaceResolver: nsResolver,
			})

			const failedSegment = stepIndex === 0 ? steps[0] : xpath.slice(steps[stepIndex - 1].length)

			const contextInfo =
				stepIndex === 0
					? '[Document root — no parent context]'
					: `[Parent element found at step ${stepIndex}]:\n${prevElement ? formatNode({ node: prevElement }) : '(none)'}`

			expect(
				element,
				`Absent assertion is unreliable: ancestor step does not exist.\n` +
					`  The query passes but for the wrong reason — an ancestor is missing, not the target element.\n` +
					`  Missing at step ${stepIndex + 1}/${steps.length}: ${failedSegment.trim()}\n` +
					`  Full XPath: ${xpath}\n` +
					`  ${contextInfo}`,
			).toBeTruthy()

			prevElement = element
		}
	}

	// Now assert the full query does NOT match
	const element = selectFirstNode({
		expression: xpath,
		xpathDocument,
		namespaceResolver: nsResolver,
	})

	expect(
		element,
		`Element should NOT exist in XML but was found.\n` +
			`  XPath: ${xpath}\n` +
			`  Found:\n${element ? formatNode({ node: element }) : '(none)'}`,
	).toBeFalsy()
}
