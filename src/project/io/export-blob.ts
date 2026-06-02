import { invariant, saveToDisk } from '@/utils'

import type { ExportBlobParams, ExportBlobResult } from '../types'

/**
 * Export a blob from the project store. Optionally triggers a browser download
 * via `saveToDisk` (mirrors `exportDocument`'s `withDownload` option).
 */
export async function exportBlob(params: ExportBlobParams): Promise<ExportBlobResult> {
	const { blobId, store, options } = params

	const result = await store.getBlob(blobId)

	invariant(result, {
		key: 'BLOB_NOT_FOUND',
		detail: `Blob "${blobId}" not found in store`,
	})

	const filename = result.entry.name

	if (options?.withDownload) {
		await saveToDisk({ data: result.data, filename })
	}

	return { entry: result.entry, data: result.data, filename }
}
