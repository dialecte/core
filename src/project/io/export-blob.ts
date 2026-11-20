import { invariant } from '@/utils'
import { openSaveTarget, writeToTarget } from '@/utils/save-to-disk'

import type { ExportBlobParams, ExportBlobResult } from '../types'

/**
 * Export a blob from the project store, and save it when asked, with where it went: to a target the caller opened
 * before; under another filename the save dialog is opened first, while the user's gesture still counts; under the
 * blob's own name, once the blob is read (its name is known then).
 *
 * @internal the store-level step behind `project.exportBlob`; callers use the project
 */
export async function exportBlob(params: ExportBlobParams): Promise<ExportBlobResult> {
	const { store, request } = params
	const { blobId, download } = request

	const earlyTarget =
		typeof download !== 'object'
			? undefined
			: 'target' in download
				? download.target
				: await openSaveTarget({ filename: download.filename })
	const result = await store.getBlob(blobId)
	invariant(result, {
		key: 'BLOB_NOT_FOUND',
		detail: `Blob "${blobId}" not found in store`,
	})

	const filename = result.entry.name
	const target = download === true ? await openSaveTarget({ filename }) : earlyTarget
	const exported = { entry: result.entry, data: result.data, filename }
	if (!target) return exported
	return { ...exported, saved: await writeToTarget({ target, data: result.data }) }
}
