import { formatXml } from './formatter'

import type { SerializeOptions } from './serialize.types'

/**
 * Serialize an XMLDocument to a formatted XML string.
 *
 * Adds the XML declaration (unless opted out via
 * {@link SerializeOptions.includeXmlDeclaration}) and runs the deterministic
 * formatter. Shared by file download and transaction snapshots so both produce
 * byte-identical output for the same document.
 */
export function xmlDocumentToString(
	xmlDocument: XMLDocument,
	options: SerializeOptions = {},
): string {
	const { includeXmlDeclaration = true } = options
	const serializer = new XMLSerializer()
	const xmlString = serializer.serializeToString(xmlDocument)

	if (!includeXmlDeclaration) return formatXml(xmlString)

	const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>\n'
	return formatXml(xmlDeclaration + xmlString)
}
