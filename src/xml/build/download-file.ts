import { formatXml } from './formatter'

import { saveToDisk } from '@/utils'

import type { AnyDialecteConfig } from '@/types'

export async function downloadFile<GenericConfig extends AnyDialecteConfig>(params: {
	extension: GenericConfig['io']['supportedFileExtensions'][number]
	xmlDocument: XMLDocument
	filename: string
}) {
	const { extension, xmlDocument, filename } = params

	const serializer = new XMLSerializer()
	const xmlString = serializer.serializeToString(xmlDocument)
	const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>\n'
	const xmlWithDeclaration = xmlDeclaration + xmlString

	const formattedXmlString = formatXml(xmlWithDeclaration)

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
