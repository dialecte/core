import { invariant } from '@/utils'
import { buildXmlDocument, downloadFile } from '@/xml'

import type { ExportDocumentParams, ExportDocumentResult } from '../types'

/**
 * Export a document as an XMLDocument built from stored records.
 * Pure orchestration - no class state mutation.
 */
export async function exportDocument(params: ExportDocumentParams): Promise<ExportDocumentResult> {
	const { documentId, state, configs, store, projectName, options } = params

	const documentState = state.documents.get(documentId)

	invariant(documentState, {
		key: 'DOCUMENT_NOT_REGISTERED',
		detail: `Document "${documentId}" not registered in project "${projectName}"`,
	})

	const config = configs[documentState.record.configKey]
	const records = await store.getByDocumentId(documentId)

	const xmlDocument = buildXmlDocument({
		records,
		config,
		withDatabaseIds: options?.withDatabaseIds,
	})

	const filename = `${documentState.record.name}${documentState.record.extension}`

	if (options?.withDownload) {
		await downloadFile({
			extension: documentState.record.extension as string,
			xmlDocument,
			filename,
		})
	}

	return { xmlDocument, filename }
}
