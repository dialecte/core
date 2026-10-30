import { printNode } from '../xml'
import {
	FAILURE_CONTEXT_MAX_LINES,
	FAILURE_HEADERS,
	MESSAGE_LABEL_WIDTH,
	MESSAGE_LINE_INDENT,
	MESSAGE_XML_INDENT,
} from './assert-xml.constants'
import { describeNearby } from './describe-nearby'
import { describeNodePlace } from './describe-node-place'

import type { XmlDocument, XmlNamespaces, XmlNode } from '../xml'
import type { QueryTrace } from './assert-xml.types'

/**
 * A query that selects nothing, as labelled lines: the query, the steps that matched, the step that failed,
 * where the last match sits, what the failing step finds there without its predicates, and the XML around it.
 */
export function describeMissingElement(params: {
	header: string
	query: string
	trace: QueryTrace
	document: XmlDocument
	namespaces: XmlNamespaces
}): string {
	const { header, query, trace, document, namespaces } = params
	const { steps, matchedSteps, lastMatch } = trace
	const matched = matchedSteps > 0 ? steps[matchedSteps - 1] : undefined
	const failedStep = matched ? steps[matchedSteps].slice(matched.length) : steps[0]
	const nearby = describeNearby({
		document,
		namespaces,
		matchedPrefix: matched,
		firstMatch: lastMatch,
		failedStep,
	})
	return [
		header,
		formatLine({ label: 'query', value: query }),
		formatLine({
			label: 'matched',
			value: `${matched ?? 'nothing'}  step ${matchedSteps} of ${steps.length}`,
		}),
		formatLine({
			label: 'failed',
			value: matched ? `${' '.repeat(matched.length)}${failedStep}` : failedStep,
		}),
		...(lastMatch ? [formatPlaceLine(lastMatch)] : []),
		...(nearby === undefined ? [] : [formatLine({ label: 'nearby', value: nearby })]),
		...formatXmlBlock({ label: 'context', node: lastMatch ?? document.root }),
	].join('\n')
}

/** A query of the unexpected list that selects a node: where it sits, and the node. */
export function describeUnexpectedElement(params: { query: string; node: XmlNode }): string {
	const { query, node } = params
	return [
		FAILURE_HEADERS.unexpectedFound,
		formatLine({ label: 'query', value: query }),
		formatPlaceLine(node),
		...formatXmlBlock({ label: 'element', node }),
	].join('\n')
}

/** A query the engine refused: the query and why. */
export function describeRefusedQuery(params: { query: string; reason: string }): string {
	const { query, reason } = params
	return [
		FAILURE_HEADERS.refused,
		formatLine({ label: 'query', value: query }),
		formatLine({ label: 'reason', value: reason }),
	].join('\n')
}

function formatLine(params: { label: string; value: string }): string {
	const { label, value } = params
	return `${MESSAGE_LINE_INDENT}${label.padEnd(MESSAGE_LABEL_WIDTH)}${value}`
}

function formatPlaceLine(node: XmlNode): string {
	const { path, line } = describeNodePlace(node)
	return formatLine({ label: 'at', value: `${path}  ${line}` })
}

/** A label alone on its line, then the node printed under it, its lines capped. */
function formatXmlBlock(params: { label: string; node: XmlNode }): string[] {
	const { label, node } = params
	const printed = printNode({ node, maxLines: FAILURE_CONTEXT_MAX_LINES })
	return [
		`${MESSAGE_LINE_INDENT}${label}`,
		...printed.split('\n').map((line) => `${MESSAGE_XML_INDENT}${line}`),
	]
}
