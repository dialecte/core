import type { XmlQueryRefusalKind } from './xml.types'

/** An XPath expression the engine refused (syntax, unbound prefix) or that answers no node set. */
export class XmlQueryRefusedError extends Error {
	readonly expression: string
	readonly reason: string
	readonly kind: XmlQueryRefusalKind

	constructor(params: { expression: string; reason: string; kind: XmlQueryRefusalKind }) {
		const { expression, reason, kind } = params
		super(`XPath expression refused: ${expression} - ${reason}`)
		this.name = 'XmlQueryRefusedError'
		this.expression = expression
		this.reason = reason
		this.kind = kind
	}
}
