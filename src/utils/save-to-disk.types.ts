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
 *
 * `discard()`, on every target, gives the target up when the file will not be written (the work was refused or
 * failed): the browser may have created the chosen file, empty, as the dialog closed, and `discard` removes it
 * (`FileSystemFileHandle.remove()`, where the browser has it; elsewhere it does nothing), and only while it is empty:
 * a picked file that holds content (an existing one) is kept. A download or a cancelled target has nothing to
 * remove. Once a `write` succeeded, `discard` does nothing: the saved file is the user's, so a cleanup that always
 * discards never deletes it (and a write cannot be undone through it). A discard during a write waits for it;
 * concurrent discards settle together; a second one does nothing. A `write` to a file or download target after a
 * `discard` is refused with `SAVE_TARGET_DISCARDED` (a cancelled target still answers `cancelled`). A file already
 * gone counts as removed; any other failure to remove it is thrown, and the next `discard` tries again.
 */
export type SaveTarget =
	| {
			outcome: Exclude<SaveOutcome, 'cancelled'>
			write: (data: Blob) => Promise<void>
			discard: () => Promise<void>
	  }
	| { outcome: 'cancelled'; discard: () => Promise<void> }

/** Where a target stands: nothing written yet, written once, or discarded. */
export type SaveTargetState = 'open' | 'written' | 'discarded'

/** A file handle with `remove()` (File System Access; not every browser has it). */
export type RemovableHandle = { remove: () => Promise<void> }

/** The page's `showSaveFilePicker` (File System Access API; Chrome and Edge). */
export type SaveFilePickerWindow = {
	showSaveFilePicker: (options: {
		suggestedName: string
		types?: SavePickerType[]
	}) => Promise<FileSystemFileHandle>
}
