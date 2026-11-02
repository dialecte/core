import { invariant } from '@/utils'
import { openSaveTarget } from '@/utils/save-to-disk'

import type { ExportBlobParams, ExportBlobResult } from '../types'

/**
 * Export a blob from the project store, and save it when asked: under another filename the save dialog is opened
 * first, while the user's gesture still counts; under the blob's own name, once the blob is read (its name is known
 * then).
 *
 * @internal the store-level step behind `project.exportBlob`; callers use the project
 */
export async function exportBlob(params: ExportBlobParams): Promise<ExportBlobResult> {
	const { store, request } = params
	const { blobId, download } = request

	const namedTarget =
		typeof download === 'object' ? await openSaveTarget({ filename: download.filename }) : undefined
	const result = await store.getBlob(blobId)
	invariant(result, {
		key: 'BLOB_NOT_FOUND',
		detail: `Blob "${blobId}" not found in store`,
	})

	const filename = result.entry.name
	const target = download === true ? await openSaveTarget({ filename }) : namedTarget
	await target?.write(result.data)

	return { entry: result.entry, data: result.data, filename }
}
