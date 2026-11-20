import { LAPSED_GESTURE_ERRORS } from './save-to-disk.constants'

import type {
	SaveFilePickerWindow,
	SaveOutcome,
	SavePickerType,
	SaveTarget,
} from './save-to-disk.types'

export type { SaveOutcome, SavePickerType, SaveTarget } from './save-to-disk.types'

/**
 * Save a Blob to disk using the native File System Access API when available
 * (Chrome / Edge) and falling back to a hidden anchor download (Safari /
 * Firefox), also when the dialog is refused because the user's gesture lapsed. The user cancelling the dialog
 * saves nothing; any other failure is thrown. Answers where the file went.
 *
 * Browser-only: relies on `window`, `document`, and `URL`.
 *
 * @intent save a Blob as a file, download an exported document, open a save dialog in the browser
 */
export async function saveToDisk(params: {
	data: Blob
	filename: string
	/** Optional picker type descriptor for `showSaveFilePicker`. */
	pickerType?: SavePickerType
}): Promise<SaveOutcome> {
	const { data, filename, pickerType } = params
	const target = await openSaveTarget({ filename, pickerType })
	return writeToTarget({ target, data })
}

/**
 * Where a file will be saved, asked BEFORE the file is made: the save dialog needs the user's gesture, which
 * lapses after a few seconds - shorter than a large export. Open it at the user's click, make the file, then write
 * it (`project.export({ download: { target } })`); a cancelled target lets the caller skip the work. The target
 * says where the file will go: the file chosen (`written`), a browser download when the dialog is refused because
 * the gesture lapsed or the browser has none (`downloaded`), or nowhere when the user cancels (`cancelled`); any
 * other failure is thrown.
 *
 * @intent ask where to save a file before making it, open a save dialog at a click, skip an export the user cancelled
 */
export async function openSaveTarget(params: {
	filename: string
	pickerType?: SavePickerType
}): Promise<SaveTarget> {
	const { filename, pickerType } = params
	const { showSaveFilePicker } = window as unknown as Partial<SaveFilePickerWindow>
	if (typeof showSaveFilePicker !== 'function') return downloadTarget({ filename })
	let handle: FileSystemFileHandle
	try {
		handle = await showSaveFilePicker.call(window, {
			suggestedName: filename,
			...(pickerType ? { types: [pickerType] } : {}),
		})
	} catch (error) {
		const name = error instanceof Error ? error.name : undefined
		if (name === 'AbortError') return { outcome: 'cancelled' }
		// the dialog refused because the user's gesture lapsed (work awaited before the save): download instead
		if (name !== undefined && LAPSED_GESTURE_ERRORS.includes(name))
			return downloadTarget({ filename })
		throw error
	}
	return { outcome: 'written', write: (data) => writeToHandle({ handle, data }) }
}

/** Write the file to a target opened before, when it was not cancelled: where the file went. */
export async function writeToTarget(params: {
	target: SaveTarget
	data: Blob
}): Promise<SaveOutcome> {
	const { target, data } = params
	if (target.outcome !== 'cancelled') await target.write(data)
	return target.outcome
}

async function writeToHandle(params: { handle: FileSystemFileHandle; data: Blob }): Promise<void> {
	const { handle, data } = params
	const writable = await handle.createWritable()
	await writable.write(data)
	await writable.close()
}

function downloadTarget(params: { filename: string }): SaveTarget {
	const { filename } = params
	return { outcome: 'downloaded', write: (data) => downloadBlob({ data, filename }) }
}

/** A browser download of the Blob, through a hidden anchor. */
async function downloadBlob(params: { data: Blob; filename: string }): Promise<void> {
	const { data, filename } = params
	const url = URL.createObjectURL(data)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = filename
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	URL.revokeObjectURL(url)
}
