import { XmlDocument, XmlParseError } from './engine'
import { MalformedXmlError } from './malformed-xml-error'
import { XML_PARSE_OPTIONS } from './with-xml-document.constants'

let openDocuments = 0
let parses = 0

/**
 * Parses `xml`, runs `read` on the document and disposes the document, also when `read` throws.
 * Text that is not well-formed throws `<label>: malformed XML - <line>:<column> <reason>`.
 */
export function withXmlDocument<GenericResult>(
	params: { xml: string; label: string },
	read: (document: XmlDocument) => GenericResult,
): GenericResult {
	const document = parseXmlDocument(params)
	openDocuments += 1
	try {
		return read(document)
	} finally {
		document.dispose()
		openDocuments -= 1
	}
}

/** The number of documents opened by `withXmlDocument` and not yet disposed. */
export function countOpenXmlDocuments(): number {
	return openDocuments
}

/** Test-only: the number of documents `withXmlDocument` has parsed since the process started. */
export function countXmlParses(): number {
	return parses
}

function parseXmlDocument(params: { xml: string; label: string }): XmlDocument {
	const { xml, label } = params
	parses += 1
	try {
		return XmlDocument.fromString(xml, XML_PARSE_OPTIONS)
	} catch (error) {
		if (!(error instanceof XmlParseError)) throw error
		throw new MalformedXmlError(describeMalformedXml({ label, error }))
	}
}

/** The first diagnostic of the engine: where the text stops being well-formed, and why. */
function describeMalformedXml(params: { label: string; error: XmlParseError }): string {
	const { label, error } = params
	const [first] = error.details
	if (!first) return `${label}: malformed XML - 0:0 ${error.message.trim()}`
	return `${label}: malformed XML - ${first.line}:${first.col} ${first.message.trim()}`
}
