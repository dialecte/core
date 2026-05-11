import xmlFormat from 'xml-formatter'

export function formatXml(xmlString: string) {
	return xmlFormat(xmlString)
}
