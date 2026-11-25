import { vi } from 'vitest'

/** The page's save dialog as the case says, and where a write went: the file chosen, a download, or nowhere. */
export function stubDialog(params: {
	dialog: 'accepted' | 'cancelled' | 'lapsed' | 'none'
}): () => 'file' | 'download' | 'nowhere' {
	const { dialog } = params
	let writtenTo: 'file' | 'download' | 'nowhere' = 'nowhere'
	// the test browser has its own dialog: no dialog is a page without the function
	if (dialog === 'none') {
		;(window as any).showSaveFilePicker = undefined
	} else {
		;(window as any).showSaveFilePicker = vi.fn(async function showSaveFilePicker(this: unknown) {
			// the native dialog refuses a call off its window
			if (this !== window) throw new TypeError('Illegal invocation')
			if (dialog === 'cancelled') throw new DOMException('cancelled', 'AbortError')
			if (dialog === 'lapsed') throw new DOMException('the gesture lapsed', 'SecurityError')
			return {
				createWritable: async () => ({
					write: async () => {
						writtenTo = 'file'
					},
					close: async () => {},
				}),
			}
		})
	}
	const anchor = document.createElement('a')
	anchor.click = () => {
		writtenTo = 'download'
	}
	vi.spyOn(document, 'createElement').mockReturnValue(anchor)
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
	return () => writtenTo
}

/** What a handle's `remove` throws when the browser refuses it for another reason than a file already gone. */
export const REMOVE_FAILURE = new DOMException('the file is locked', 'NoModificationAllowedError')

/**
 * The page's save dialog as the case says, its chosen file's handle removable as the case says: how many times
 * `remove` was called. The chosen file holds `fileSize` bytes (empty by default, as the browser makes a new one);
 * a failing write leaves it as it was. `hold` keeps the write or the remove pending until its promise settles.
 */
export function stubRemovableDialog(params: {
	dialog: 'accepted' | 'cancelled' | 'lapsed' | 'none'
	remove: 'supported' | 'absent' | 'not found' | 'failing' | 'failing once'
	failWrite: boolean
	fileSize?: number
	hold?: { step: 'write' | 'remove'; until: Promise<void> }
}): () => number {
	const { dialog, remove, failWrite, fileSize = 0, hold } = params
	let removes = 0
	stubDialog({ dialog })
	if (dialog !== 'accepted') return () => removes
	async function held(step: 'write' | 'remove') {
		if (hold?.step === step) await hold.until
	}
	const handle = {
		getFile: async () => new File(['x'.repeat(fileSize)], 'a.txt'),
		createWritable: async () => ({
			write: async () => {
				await held('write')
				if (failWrite) throw new DOMException('disk full', 'QuotaExceededError')
			},
			close: async () => {},
			abort: async () => {},
		}),
		...(remove === 'absent'
			? {}
			: {
					remove: async () => {
						removes += 1
						await held('remove')
						if (remove === 'not found') throw new DOMException('gone', 'NotFoundError')
						if (remove === 'failing') throw REMOVE_FAILURE
						if (remove === 'failing once' && removes === 1) throw REMOVE_FAILURE
					},
				}),
	}
	;(window as any).showSaveFilePicker = vi.fn(async function showSaveFilePicker() {
		return handle
	})
	return () => removes
}

/** A promise settled from outside: `resolve` lets what awaits it go on. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => {}
	const promise = new Promise<void>(function hold(settle) {
		resolve = settle
	})
	return { promise, resolve }
}
