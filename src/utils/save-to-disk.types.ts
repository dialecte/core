/** The file types a save dialog offers (`showSaveFilePicker`'s `types` entry). */
export type SavePickerType = {
	description: string
	accept: Record<string, string[]>
}

/**
 * Where a saved file went: `written` to the file chosen in the save dialog, `downloaded` through a browser
 * download (no dialog in the browser, or one refused because the user's gesture lapsed; the browser may still
 * ask), or `cancelled` with the dialog, nothing written.
 */
export type SaveOutcome = 'written' | 'downloaded' | 'cancelled'

/**
 * Where a file goes once it is ready, asked before it is made: the file chosen in the save dialog or a browser
 * download, each with its `write`; a cancelled dialog leaves nothing to write to.
 */
export type SaveTarget =
	| { outcome: Exclude<SaveOutcome, 'cancelled'>; write: (data: Blob) => Promise<void> }
	| { outcome: 'cancelled' }

/** The page's `showSaveFilePicker` (File System Access API; Chrome and Edge). */
export type SaveFilePickerWindow = {
	showSaveFilePicker: (options: {
		suggestedName: string
		types?: SavePickerType[]
	}) => Promise<FileSystemFileHandle>
}
