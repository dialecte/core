import { splitXpathIntoSteps } from './xpath-parser'

import { expect } from 'vitest'
import xmlFormat from 'xml-formatter'

import type { NsResolver } from './types'
import type { Namespace } from '@/types'

/**
 * Creates a pair of assertion functions pre-configured with a namespace resolver
 * derived from a prefix → URI map. Intended to be instantiated once per dialecte
 * (e.g. in scl test-fixtures) and re-exported alongside createTestDialecte.
 */
export function createXmlAssertions(params: { namespaces: Record<string, Namespace> }) {
	const { namespaces } = params
	const nsResolver = buildNsResolver(namespaces)

	return {
		assertExpectedElementQueries(params: { xmlDocument: XMLDocument; queries: string[] }) {
			assertExpectedElementQueries({ ...params, nsResolver })
		},
		assertUnexpectedElementQueries(params: { xmlDocument: XMLDocument; queries: string[] }) {
			assertUnexpectedElementQueries({ ...params, nsResolver })
		},
	}
}
/**
 * Assert that each XPath query matches at least one element in the document.
 * When a query fails, the error message shows which step failed
 * and the XML of the last successful match for debugging.
 */
export function assertExpectedElementQueries(params: {
	xmlDocument: XMLDocument
	queries: string[]
	nsResolver?: NsResolver
}) {
	const { xmlDocument, queries, nsResolver } = params
	for (const query of queries) {
		assertExpectedXPath({ xmlDocument, xpath: query, nsResolver })
	}
}

/**
 *  Builds a namespace resolver function from a map of prefix to URI.
 * @param namespaces
 * @returns
 */
function buildNsResolver(namespaces: Record<string, Namespace>): NsResolver {
	return (prefix: string | null) => (prefix ? (namespaces[prefix]?.uri ?? null) : null)
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
export function assertUnexpectedElementQueries(params: {
	xmlDocument: XMLDocument
	queries: string[]
	nsResolver?: NsResolver
}) {
	const { xmlDocument, queries, nsResolver } = params
	for (const query of queries) {
		assertUnexpectedXPath({ xmlDocument, xpath: query, nsResolver })
	}
}

function assertExpectedXPath(params: {
	xmlDocument: XMLDocument
	xpath: string
	nsResolver?: NsResolver
}) {
	const { xmlDocument, xpath, nsResolver } = params
	const steps = splitXpathIntoSteps(xpath)

	let prevElement: Element | null = null
	let lastSuccessfulStep = 0

	for (let i = 0; i < steps.length; i++) {
		const stepXpath = steps[i]
		const result = xmlDocument.evaluate(
			stepXpath,
			xmlDocument,
			nsResolver ?? null,
			XPathResult.FIRST_ORDERED_NODE_TYPE,
			null,
		)
		const element = result.singleNodeValue as Element | null

		if (element) {
			prevElement = element
			lastSuccessfulStep = i + 1
			continue
		}

		const failedSegment = i === 0 ? steps[0] : xpath.slice(steps[i - 1].length)

		const contextInfo =
			lastSuccessfulStep === 0
				? `[No parent matched — failed from document root]\n  Document:\n${formatXml({ xml: new XMLSerializer().serializeToString(xmlDocument) })}`
				: `[Last match at step ${lastSuccessfulStep}/${steps.length}]:\n${prevElement ? formatXml({ xml: prevElement.outerHTML }) : '(none)'}`

		expect(
			element,
			`Element not found in XML.\n` +
				`  Failed at step ${i + 1}/${steps.length}: ${failedSegment.trim()}\n` +
				`  Full XPath: ${xpath}\n` +
				`  ${contextInfo}`,
		).toBeTruthy()

		return
	}
}

function formatXml(params: { xml: string }): string {
	const { xml } = params
	try {
		return xmlFormat(xml, { indentation: '  ', collapseContent: true })
	} catch {
		return xml
	}
}

function assertUnexpectedXPath(params: {
	xmlDocument: XMLDocument
	xpath: string
	nsResolver?: NsResolver
}) {
	const { xmlDocument, xpath, nsResolver } = params
	const steps = splitXpathIntoSteps(xpath)

	// For multi-step queries, verify all steps except the last one DO exist
	// This ensures the absence assertion is meaningful
	if (steps.length > 1) {
		let prevElement: Element | null = null

		for (let i = 0; i < steps.length - 1; i++) {
			const stepXpath = steps[i]
			const result = xmlDocument.evaluate(
				stepXpath,
				xmlDocument,
				nsResolver ?? null,
				XPathResult.FIRST_ORDERED_NODE_TYPE,
				null,
			)
			const element = result.singleNodeValue as Element | null

			const failedSegment = i === 0 ? steps[0] : xpath.slice(steps[i - 1].length)

			const contextInfo =
				i === 0
					? '[Document root — no parent context]'
					: `[Parent element found at step ${i}]:\n${prevElement ? formatXml({ xml: prevElement.outerHTML }) : '(none)'}`

			expect(
				element,
				`Absent assertion is unreliable: ancestor step does not exist.\n` +
					`  The query passes but for the wrong reason — an ancestor is missing, not the target element.\n` +
					`  Missing at step ${i + 1}/${steps.length}: ${failedSegment.trim()}\n` +
					`  Full XPath: ${xpath}\n` +
					`  ${contextInfo}`,
			).toBeTruthy()

			prevElement = element
		}
	}

	// Now assert the full query does NOT match
	const result = xmlDocument.evaluate(
		xpath,
		xmlDocument,
		nsResolver ?? null,
		XPathResult.FIRST_ORDERED_NODE_TYPE,
		null,
	)
	const element = result.singleNodeValue as Element | null

	expect(
		element,
		`Element should NOT exist in XML but was found.\n` +
			`  XPath: ${xpath}\n` +
			`  Found:\n${element ? formatXml({ xml: element.outerHTML }) : '(none)'}`,
	).toBeFalsy()
}
