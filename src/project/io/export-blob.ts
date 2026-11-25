import { invariant } from '@/utils'
import { discardOnFailure, openSaveTarget, writeToTarget } from '@/utils/save-to-disk'

import type { ExportBlobAnswer, ExportBlobParams } from '../types'

/**
 * Export a blob from the project store, and save it when asked, with where it went: to a target the caller opened
 * before; under another filename the save dialog is opened first, while the user's gesture still counts; under the
 * blob's own name, once the blob is read (its name is known then). A failure discards a dialog it opened; a
 * target the caller passed is left to the caller.
 *
 * @internal the store-level step behind `project.exportBlob`; callers use the project
 */
export async function exportBlob(params: ExportBlobParams): Promise<ExportBlobAnswer> {
	const { store, request } = params
	const { blobId, download } = request

	// a dialog the export opens is its own to discard when the export fails; a caller's target stays the caller's
	const opened =
		typeof download === 'object' && !('target' in download)
			? await openSaveTarget({ filename: download.filename })
			: undefined
	const result = await discardOnFailure({
		target: opened,
		work: async () => {
			const found = await store.getBlob(blobId)
			invariant(found, {
				key: 'BLOB_NOT_FOUND',
				detail: `Blob "${blobId}" not found in store`,
			})
			return found
		},
	})

	const filename = result.entry.name
	const exported = { entry: result.entry, data: result.data, filename }
	const late = download === true ? await openSaveTarget({ filename }) : undefined
	const target = late ?? opened ?? (typeof download === 'object' ? download.target : undefined)
	if (!target) return exported
	const saved = await discardOnFailure({
		target: late ?? opened,
		work: () => writeToTarget({ target, data: result.data }),
	})
	return { ...exported, saved }
}
