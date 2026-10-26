import { LAPSED_GESTURE_ERRORS } from './save-to-disk.constants'

import type { SaveFilePickerWindow, SavePickerType, SaveTarget } from './save-to-disk.types'

export type { SavePickerType, SaveTarget } from './save-to-disk.types'

/**
 * Save a Blob to disk using the native File System Access API when available
 * (Chrome / Edge) and falling back to a hidden anchor download (Safari /
 * Firefox), also when the dialog is refused because the user's gesture lapsed. The user cancelling the dialog
 * saves nothing; any other failure is thrown.
 *
 * Browser-only: relies on `window`, `document`, and `URL`.
 */
export async function saveToDisk(params: {
	data: Blob
	filename: string
	/** Optional picker type descriptor for `showSaveFilePicker`. */
	pickerType?: SavePickerType
}): Promise<void> {
	const { data, filename, pickerType } = params
	const target = await openSaveTarget({ filename, pickerType })
	await target?.write(data)
}

/**
 * Where a file will be saved, asked BEFORE the file is made: the save dialog needs the user's gesture, which
 * lapses after a few seconds - shorter than a large export. `undefined` when the user cancels the dialog; a dialog
 * refused because the gesture lapsed, or no File System Access API, gives a browser download; any other failure is
 * thrown.
 */
export async function openSaveTarget(params: {
	filename: string
	pickerType?: SavePickerType
}): Promise<SaveTarget | undefined> {
	const { filename, pickerType } = params
	if (!('showSaveFilePicker' in window)) return downloadTarget({ filename })
	let handle: FileSystemFileHandle
	try {
		handle = await (window as unknown as SaveFilePickerWindow).showSaveFilePicker({
			suggestedName: filename,
			...(pickerType ? { types: [pickerType] } : {}),
		})
	} catch (error) {
		const name = error instanceof Error ? error.name : undefined
		if (name === 'AbortError') return undefined
		// the dialog refused because the user's gesture lapsed (work awaited before the save): download instead
		if (name !== undefined && LAPSED_GESTURE_ERRORS.includes(name))
			return downloadTarget({ filename })
		throw error
	}
	return { write: (data) => writeToHandle({ handle, data }) }
}

async function writeToHandle(params: { handle: FileSystemFileHandle; data: Blob }): Promise<void> {
	const { handle, data } = params
	const writable = await handle.createWritable()
	await writable.write(data)
	await writable.close()
}

function downloadTarget(params: { filename: string }): SaveTarget {
	const { filename } = params
	return { write: (data) => downloadBlob({ data, filename }) }
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
