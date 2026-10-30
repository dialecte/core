import { XmlDocument } from './engine'
import { runEngineQuietly } from './engine-console'
import { XmlQueryRefusedError } from './xml-query-refused-error'
import {
	ENGINE_COMPILE_FAILURE_PREFIX,
	ENGINE_UNBOUND_PREFIX_REASON,
	ENGINE_XPATH_DIAGNOSTIC_PREFIX,
} from './xml.constants'

import type { XmlNamespaces, XmlNode, XmlQueryContext, XmlQueryRefusalKind } from './xml.types'

/** The nodes an XPath 1.0 expression selects from a document or an element, in document order. */
export function selectNodes(params: {
	context: XmlQueryContext
	expression: string
	namespaces: XmlNamespaces
}): XmlNode[] {
	const { context, expression, namespaces } = params
	const contextNode = contextNodeOf(context)
	const call = runEngineQuietly(function evaluate() {
		return contextNode.eval(expression, namespaces)
	})
	if (!call.completed) {
		const reason = reasonOf(call)
		throw new XmlQueryRefusedError({
			expression,
			reason,
			kind: kindOf({ error: call.error, reason }),
		})
	}
	if (!Array.isArray(call.value)) {
		throw new XmlQueryRefusedError({
			expression,
			reason: `it answers a ${typeof call.value}, not a node set`,
			kind: 'not-a-node-set',
		})
	}
	return call.value
}

/** The first node an expression selects; an expression that answers no node set is refused. */
export function selectFirstNode(params: {
	context: XmlQueryContext
	expression: string
	namespaces: XmlNamespaces
}): XmlNode | undefined {
	return selectNodes(params)[0]
}

/** XPath reads a document from its document node, not from its root element. */
function contextNodeOf(context: XmlQueryContext): XmlNode {
	if (!(context instanceof XmlDocument)) return context
	const documentNode = context.root.get('/')
	if (!documentNode) throw new Error('a parsed document has a document node')
	return documentNode
}

/** Why the engine refused: what it wrote while it ran, or the error it threw. */
function reasonOf(call: { error: unknown; engineLines: string[] }): string {
	const { error, engineLines } = call
	const diagnostics = engineLines
		.map((line) => line.replace(ENGINE_XPATH_DIAGNOSTIC_PREFIX, '').trim())
		.filter((line) => line !== '')
	if (diagnostics.length > 0) return diagnostics.join('; ')
	return error instanceof Error ? error.message : String(error)
}

/** What kind of refusal: the engine's error tells a compile failure apart, its diagnostic an unbound prefix. */
function kindOf(params: { error: unknown; reason: string }): XmlQueryRefusalKind {
	const { error, reason } = params
	if (error instanceof Error && error.message.startsWith(ENGINE_COMPILE_FAILURE_PREFIX))
		return 'syntax'
	if (reason.includes(ENGINE_UNBOUND_PREFIX_REASON)) return 'unbound-prefix'
	return 'evaluation'
}
