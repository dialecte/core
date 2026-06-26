import { formatXml } from './formatter'

/**
 * Serialize an XMLDocument to a formatted XML string.
 *
 * Adds the XML declaration and runs the deterministic formatter.
 * Shared by file download and transaction snapshots so both produce
 * byte-identical output for the same document.
 */
export function xmlDocumentToString(xmlDocument: XMLDocument): string {
	const serializer = new XMLSerializer()
	const xmlString = serializer.serializeToString(xmlDocument)
	const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>\n'

	return formatXml(xmlDeclaration + xmlString)
}
