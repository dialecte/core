import { FILE_ALREADY_GONE_ERROR, LAPSED_GESTURE_ERRORS } from './save-to-disk.constants'

import { throwDialecteError } from '@/errors'

import type {
	SaveFilePickerWindow,
	SaveOutcome,
	SavePickerType,
	SaveTarget,
	SaveTargetState,
	RemovableHandle,
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
 * The browser may create the chosen file, empty, as the dialog closes: when the work is refused or fails, call
 * `target.discard()` to remove it (see `SaveTarget`).
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
		if (name === 'AbortError') return { outcome: 'cancelled', discard: async () => {} }
		// the dialog refused because the user's gesture lapsed (work awaited before the save): download instead
		if (name !== undefined && LAPSED_GESTURE_ERRORS.includes(name))
			return downloadTarget({ filename })
		throw error
	}
	return trackedTarget({
		outcome: 'written',
		write: (data) => writeToHandle({ handle, data }),
		discard: () => removeHandle({ handle }),
	})
}

/**
 * Write the file to a target opened before, when it was not cancelled: where the file went.
 *
 * @internal the write step of `saveToDisk` and of the project's exports
 */
export async function writeToTarget(params: {
	target: SaveTarget
	data: Blob
}): Promise<SaveOutcome> {
	const { target, data } = params
	if (target.outcome !== 'cancelled') await target.write(data)
	return target.outcome
}

/**
 * Run the work for a target opened for it (by an export, not by its caller): a failure discards the target, then
 * is thrown as it was (a discard that fails too is dropped, the work's failure is the one to see).
 *
 * @internal the cleanup of the project's exports
 */
export async function discardOnFailure<Result>(params: {
	target: SaveTarget | undefined
	work: () => Promise<Result>
}): Promise<Result> {
	const { target, work } = params
	try {
		return await work()
	} catch (error) {
		await target?.discard().catch(() => {})
		throw error
	}
}

async function writeToHandle(params: { handle: FileSystemFileHandle; data: Blob }): Promise<void> {
	const { handle, data } = params
	const writable = await handle.createWritable()
	try {
		await writable.write(data)
		await writable.close()
	} catch (error) {
		// an open writable keeps its lock and swap file, and leaves the chosen file empty
		await writable.abort().catch(() => {})
		throw error
	}
}

function downloadTarget(params: { filename: string }): SaveTarget {
	const { filename } = params
	return trackedTarget({
		outcome: 'downloaded',
		write: (data) => downloadBlob({ data, filename }),
		discard: async () => {},
	})
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

/**
 * A target whose `discard` runs only while nothing was written to it. A discard during a write waits for it: a
 * write that succeeded keeps the file (the saved file is the user's), one that failed leaves it to remove.
 * Concurrent discards share one removal; a removal that fails can be retried. A write is refused once a discard
 * was asked, unless that discard found the file written.
 */
function trackedTarget(params: {
	outcome: Exclude<SaveOutcome, 'cancelled'>
	write: (data: Blob) => Promise<void>
	discard: () => Promise<void>
}): SaveTarget {
	const { outcome, write, discard } = params
	let state: SaveTargetState = 'open'
	let writing: Promise<void> | undefined
	let discarding: Promise<void> | undefined

	async function writeOnce(data: Blob): Promise<void> {
		await write(data)
		state = 'written'
	}

	async function discardOnce(): Promise<void> {
		await writing?.catch(() => {})
		if (state !== 'open') return
		state = 'discarded'
		try {
			await discard()
		} catch (error) {
			// the file is still there: the next discard tries again
			state = 'open'
			discarding = undefined
			throw error
		}
	}

	return {
		outcome,
		write: async function writeTarget(data) {
			if (discarding !== undefined && state !== 'written') {
				throwDialecteError('SAVE_TARGET_DISCARDED', {
					detail: 'The save target was discarded: nothing is written to it.',
				})
			}
			const run = writeOnce(data)
			writing = run
			try {
				await run
			} finally {
				// a newer write keeps its own: a discard waits for the latest one
				if (writing === run) writing = undefined
			}
		},
		discard: function discardTarget() {
			discarding ??= discardOnce()
			return discarding
		},
	}
}

/**
 * Remove the chosen file where the browser can (`FileSystemFileHandle.remove`), only while it is empty: a file the
 * user picked that holds content (an existing file, or one a failed write left as it was) is kept. A file already
 * gone is removed.
 */
async function removeHandle(params: { handle: FileSystemFileHandle }): Promise<void> {
	const { handle } = params
	const { remove } = handle as FileSystemFileHandle & Partial<RemovableHandle>
	if (typeof remove !== 'function') return
	try {
		const file = await handle.getFile()
		if (file.size > 0) return
		await remove.call(handle)
	} catch (error) {
		if (error instanceof Error && error.name === FILE_ALREADY_GONE_ERROR) return
		throw error
	}
}
