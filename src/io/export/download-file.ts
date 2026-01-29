import { formatXml } from './formatter'

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

	const fileAsBlob = new Blob([formattedXmlString], { type: 'application/xml' })

	// Native saveAs Api (Chrome/Edge)
	if ('showSaveFilePicker' in window) {
		try {
			const handle = await (window as any).showSaveFilePicker({
				suggestedName: filename,
				types: [
					{
						description: 'FSD Files',
						accept: { 'application/xml': [extension] },
					},
				],
			})
			const writable = await handle.createWritable()
			await writable.write(fileAsBlob)
			await writable.close()
		} catch (err) {
			// User cancelled or error - don't show error for cancellation
			if ((err as Error).name !== 'AbortError') {
				console.error('Save failed:', err)
			}
		}
	} else {
		// Fallback for Safari/Firefox - auto-downloads (saveAs Api not supported)
		const url = URL.createObjectURL(fileAsBlob)
		const downloadElement = document.createElement('a')
		downloadElement.href = url
		downloadElement.download = filename
		document.body.appendChild(downloadElement)
		downloadElement.click()
		downloadElement.remove()
		URL.revokeObjectURL(url)
	}
}
