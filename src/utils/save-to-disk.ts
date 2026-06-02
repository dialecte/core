/**
 * Save a Blob to disk using the native File System Access API when available
 * (Chrome / Edge) and falling back to a hidden anchor download (Safari /
 * Firefox).
 *
 * Browser-only: relies on `window`, `document`, and `URL`.
 */
export async function saveToDisk(params: {
	data: Blob
	filename: string
	/** Optional picker type descriptor for `showSaveFilePicker`. */
	pickerType?: {
		description: string
		accept: Record<string, string[]>
	}
}): Promise<void> {
	const { data, filename, pickerType } = params

	if ('showSaveFilePicker' in window) {
		try {
			const handle = await (window as any).showSaveFilePicker({
				suggestedName: filename,
				...(pickerType ? { types: [pickerType] } : {}),
			})
			const writable = await handle.createWritable()
			await writable.write(data)
			await writable.close()
			return
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			console.error('Save failed:', err)
			return
		}
	}

	const url = URL.createObjectURL(data)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = filename
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	URL.revokeObjectURL(url)
}
