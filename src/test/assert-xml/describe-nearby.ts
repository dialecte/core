import { XmlElement, XmlQueryRefusedError, selectNodes } from '../xml'
import { ABBREVIATED_AXES, NEARBY_CANDIDATE_LIMIT, UNION_OPERATOR } from './assert-xml.constants'
import { describeNodePlace, qualifiedNameOf } from './describe-node-place'
import { readXpathStep } from './read-xpath-step'

import type { XmlDocument, XmlNamespaces, XmlNode, XmlQueryContext } from '../xml'
import type { XpathStepReading } from './assert-xml.types'

/**
 * What the failing step selects once its predicates are left out, under every node the matched prefix selects
 * (or from the document when nothing matched): up to ten candidates, each with the attributes the predicates name
 * and its line. When no node has the step's name there, `none: <tag> has no <name> <axis>`, and the same local
 * name in another namespace is named with the prefix that stands for it. Undefined when the step cannot be read so,
 * and for a union: its branches are not one step, so leaving out predicates would only repeat the query.
 */
export function describeNearby(params: {
	document: XmlDocument
	namespaces: XmlNamespaces
	matchedPrefix: string | undefined
	firstMatch: XmlNode | undefined
	failedStep: string
}): string | undefined {
	const { document, namespaces, matchedPrefix, firstMatch, failedStep } = params
	const step = readXpathStep(failedStep)
	if (step.withoutPredicates.includes(UNION_OPERATOR)) return undefined
	const underPrefix = matchedPrefix === undefined ? '' : `(${matchedPrefix})`
	const candidates = trySelectNodes({
		context: document,
		expression: `${underPrefix}${step.withoutPredicates}`,
		namespaces,
	})
	if (!candidates) return undefined
	if (candidates.length > 0) return listCandidates({ candidates, step, namespaces })
	return describeNoCandidate({ document, underPrefix, firstMatch, step, namespaces })
}

function listCandidates(params: {
	candidates: XmlNode[]
	step: XpathStepReading
	namespaces: XmlNamespaces
}): string {
	const { candidates, step, namespaces } = params
	const listed = candidates.slice(0, NEARBY_CANDIDATE_LIMIT).map(function describeCandidate(node) {
		const { path, line } = describeNodePlace(node)
		if (!(node instanceof XmlElement)) return `${path} (${line})`
		const attributes = step.predicateAttributes.flatMap(function printAttribute(name) {
			const attribute = findAttribute({ element: node, name, namespaces })
			return attribute ? [`${qualifiedNameOf(attribute)}="${attribute.value}"`] : []
		})
		return `${[qualifiedNameOf(node), ...attributes].join(' ')} (${line})`
	})
	const leftOut = candidates.length - listed.length
	return leftOut > 0 ? `${listed.join(', ')}, … (${leftOut} more)` : listed.join(', ')
}

/** The attribute an XPath name (`aA`, `ext:aAA_3`) stands for on an element. */
function findAttribute(params: { element: XmlElement; name: string; namespaces: XmlNamespaces }) {
	const { element, name, namespaces } = params
	const [prefix, localName] = name.includes(':') ? name.split(':') : [undefined, name]
	const namespaceUri = prefix === undefined ? '' : namespaces[prefix]
	return element.attrs.find(
		(attribute) => attribute.name === localName && attribute.namespaceUri === namespaceUri,
	)
}

function describeNoCandidate(params: {
	document: XmlDocument
	underPrefix: string
	firstMatch: XmlNode | undefined
	step: XpathStepReading
	namespaces: XmlNamespaces
}): string {
	const { document, underPrefix, firstMatch, step, namespaces } = params
	if (!step.name) return `none: nothing there matches ${step.withoutPredicates}`
	const { localName, prefix } = step.name
	const owner = ownerNameOf(firstMatch)
	const axis = step.axis ?? ABBREVIATED_AXES[step.separator] ?? 'child'
	const axisPart = step.axis ? `${step.axis}::` : ''
	const namesakes =
		trySelectNodes({
			context: document,
			expression: `${underPrefix}${step.separator}${axisPart}*[local-name() = "${localName}"]`,
			namespaces,
		}) ?? []
	const expectedNamespaceUri = prefix === undefined ? '' : namespaces[prefix]
	const otherNamespaceUris = new Set(
		namesakes
			.filter((node): node is XmlElement => node instanceof XmlElement)
			.map((element) => element.namespaceUri)
			.filter((namespaceUri) => namespaceUri !== expectedNamespaceUri),
	)
	const hints = [...otherNamespaceUris].map((namespaceUri) =>
		describeNamesake({ localName, namespaceUri, namespaces }),
	)
	return [`none: ${owner} has no ${localName} ${axis}`, ...hints].join('; ')
}

/** Who the failing step was read from: the first match's name, or the document when nothing matched. */
function ownerNameOf(firstMatch: XmlNode | undefined): string {
	if (!firstMatch) return 'the document'
	return firstMatch instanceof XmlElement ? qualifiedNameOf(firstMatch) : 'the matched node'
}

/** The same local name in another namespace, with the prefix to type for it. */
function describeNamesake(params: {
	localName: string
	namespaceUri: string
	namespaces: XmlNamespaces
}): string {
	const { localName, namespaceUri, namespaces } = params
	const prefix = Object.keys(namespaces).find((key) => namespaces[key] === namespaceUri)
	if (prefix) return `${prefix}:${localName} exists (${prefix} = ${namespaceUri})`
	if (namespaceUri === '') return `${localName} exists in no namespace`
	return `${localName} exists in ${namespaceUri}, which no prefix stands for`
}

/** The nodes an expression selects, or undefined when the engine refuses it. */
function trySelectNodes(params: {
	context: XmlQueryContext
	expression: string
	namespaces: XmlNamespaces
}): XmlNode[] | undefined {
	try {
		return selectNodes(params)
	} catch (error) {
		if (error instanceof XmlQueryRefusedError) return undefined
		throw error
	}
}
