/** The file types a save dialog offers (`showSaveFilePicker`'s `types` entry). */
export type SavePickerType = {
	description: string
	accept: Record<string, string[]>
}

/** Where a file goes once it is ready: the file chosen in the save dialog, or a browser download. */
export type SaveTarget = {
	write: (data: Blob) => Promise<void>
}

/** The page's `showSaveFilePicker` (File System Access API; Chrome and Edge). */
export type SaveFilePickerWindow = {
	showSaveFilePicker: (options: {
		suggestedName: string
		types?: SavePickerType[]
	}) => Promise<FileSystemFileHandle>
}
