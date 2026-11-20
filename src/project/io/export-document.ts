import { invariant } from '@/utils'
import { openSaveTarget, writeToTarget } from '@/utils/save-to-disk'
import { parseXmlDocument } from '@/xml/dom'

import type {
	DocumentRecord,
	ExportDocumentParams,
	ExportLayoutParams,
	ProjectExportResult,
	ProjectExportResultMaybeDocument,
} from '../types'
import type { SavePickerType, SaveTarget } from '@/utils/save-to-disk'

/**
 * Export a document through the store: its file in the layout asked and, on the page, its DOM (parsed from a
 * compact export) and its save (a formatted export), with where it went. The save target is asked first, while the
 * user's gesture still counts, unless the caller opened one before; a store export is made once more when an option
 * needs the other layout, never for a cancelled save.
 */
export async function exportDocument(
	params: ExportDocumentParams,
): Promise<ProjectExportResultMaybeDocument> {
	const { store, state, projectName, perf, request } = params
	const { documentId, indent = true, withDatabaseIds, xmlDocument, download } = request

	const documentState = state.documents.get(documentId)
	invariant(documentState, {
		key: 'DOCUMENT_NOT_REGISTERED',
		detail: `Document "${documentId}" not registered in project "${projectName}"`,
	})
	const { record } = documentState

	const saveTarget = await saveTargetOf({ download, record })

	const exported = await exportLayout({ store, documentId, indent, withDatabaseIds, perf })
	const saved = saveTarget && {
		saved: await writeToTarget({
			target: saveTarget,
			data:
				indent || saveTarget.outcome === 'cancelled'
					? exported.file
					: (await exportLayout({ store, documentId, indent: true, withDatabaseIds, perf })).file,
		}),
	}
	if (!xmlDocument) return { ...exported, ...saved }
	const compact = indent
		? (await exportLayout({ store, documentId, indent: false, withDatabaseIds, perf })).file
		: exported.file
	const parsed = await parseXmlDocument({ file: compact })
	return { ...exported, ...saved, xmlDocument: parsed }
}

/** Where the file is saved: nowhere, the target the caller opened, or a save dialog opened now. */
async function saveTargetOf(params: {
	download: ExportDocumentParams['request']['download']
	record: DocumentRecord
}): Promise<SaveTarget | undefined> {
	const { download, record } = params
	if (!download) return undefined
	if (typeof download === 'object' && 'target' in download) return download.target
	return openSaveTarget({
		filename: download === true ? `${record.name}${record.extension}` : download.filename,
		pickerType: pickerTypeOf({ extension: record.extension }),
	})
}

/** One store export in that layout, its timings merged into the project's perf. */
async function exportLayout(params: ExportLayoutParams): Promise<ProjectExportResult> {
	const { store, documentId, indent, withDatabaseIds, perf } = params
	const result = await store.exportFile({ documentId, options: { indent, withDatabaseIds } })
	if (result.perf) perf?.merge({ report: result.perf, prefix: 'store' })
	return { file: result.file, filename: result.filename }
}

/** The save dialog's file type: the document's extension, as XML. */
function pickerTypeOf(params: Pick<DocumentRecord, 'extension'>): SavePickerType {
	const { extension } = params
	return {
		description: `${extension.replace(/^\./, '').toUpperCase()} Files`,
		accept: { 'application/xml': [extension] },
	}
}
