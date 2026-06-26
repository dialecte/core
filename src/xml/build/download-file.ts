import { xmlDocumentToString } from './serialize'

import { saveToDisk } from '@/utils'

import type { AnyDialecteConfig } from '@/types'

export async function downloadFile<GenericConfig extends AnyDialecteConfig>(params: {
	extension: GenericConfig['io']['supportedFileExtensions'][number]
	xmlDocument: XMLDocument
	filename: string
}) {
	const { extension, xmlDocument, filename } = params

	const formattedXmlString = xmlDocumentToString(xmlDocument)

	const data = new Blob([formattedXmlString], { type: 'application/xml' })

	await saveToDisk({
		data,
		filename,
		pickerType: {
			description: `${extension.replace(/^\./, '').toUpperCase()} Files`,
			accept: { 'application/xml': [extension] },
		},
	})
}
