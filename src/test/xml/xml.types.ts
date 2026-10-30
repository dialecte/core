import type {
	XmlAttribute as Libxml2Attribute,
	XmlDocument as Libxml2Document,
	XmlElement as Libxml2Element,
	XmlNode as Libxml2Node,
} from 'libxml2-wasm'

export type XmlDocument = Libxml2Document
export type XmlElement = Libxml2Element
export type XmlAttribute = Libxml2Attribute
export type XmlNode = Libxml2Node

/** XPath prefix to namespace URI. */
export type XmlNamespaces = Record<string, string>

/** Where an XPath expression starts: a whole document, or one of its elements. */
export type XmlQueryContext = XmlDocument | XmlElement

/** A console writer, as `console.log` and `console.error` are. */
export type ConsoleWriter = (...data: unknown[]) => void

/** What the engine wrote while a seam call ran: held back, for the call's error message. */
export type EngineConsoleState = {
	quietCalls: number
	heldLines: string[]
}

/** An engine call run quietly: its value, or its error with the lines the engine wrote meanwhile. */
export type QuietEngineCall<GenericValue> =
	| { completed: true; value: GenericValue }
	| { completed: false; error: unknown; engineLines: string[] }

/**
 * Why an expression was refused: it does not compile, it names a prefix the namespaces do not bind, it answers a
 * number, a string or a boolean where nodes are asked, or the engine failed it while evaluating.
 */
export type XmlQueryRefusalKind = 'syntax' | 'unbound-prefix' | 'not-a-node-set' | 'evaluation'
