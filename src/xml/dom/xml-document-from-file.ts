import { throwDialecteError } from '@/errors'

import type { ParseXmlDocumentParams } from './xml-document-from-file.types'

/**
 * The DOM of an XML file, in the page (a worker or Node has no `DOMParser`). Parse the compact export
 * (`indent: false`) to get the document the stored records make, with no whitespace-only text node.
 * A file that is not well-formed throws `PARSE_ERROR`, with what the parser said.
 *
 * @intent get the DOM of an exported XML file, read an export as an XMLDocument in the page, query an export with XPath
 */
export async function parseXmlDocument(params: ParseXmlDocumentParams): Promise<XMLDocument> {
	const { file } = params
	const text = await file.text()
	const xmlDocument = new DOMParser().parseFromString(text, 'application/xml')
	const parserError = xmlDocument.getElementsByTagName('parsererror')[0]
	if (parserError) {
		throwDialecteError('PARSE_ERROR', {
			detail: parserError.textContent?.trim() || 'The file is not well-formed XML',
		})
	}
	return xmlDocument
}
