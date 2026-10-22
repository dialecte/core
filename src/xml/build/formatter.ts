import xmlFormat from 'xml-formatter'

/**
 * Indent an XML string for a written file by depth. An element that holds text is written as is on its
 * line, children included (`<Item>2025-08-04 10:59:16</Item>`), so formatting adds no whitespace to a
 * value.
 */
export function formatXml(xmlString: string) {
	return xmlFormat(xmlString, { collapseContent: true })
}
