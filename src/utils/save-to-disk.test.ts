import { openSaveTarget, saveToDisk } from './save-to-disk'

import { describe, it, expect, vi, afterEach } from 'vitest'

import { runTestCases } from '@/test'

import type { SaveOutcome } from './save-to-disk.types'
import type { BaseTestCase } from '@/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

type MockWritable = { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

function stubPicker(handle: { createWritable: () => Promise<MockWritable> } | (() => never)) {
	const picker = typeof handle === 'function' ? vi.fn(handle) : vi.fn().mockResolvedValue(handle)
	;(window as any).showSaveFilePicker = picker
	return picker
}

function makeWritable(): MockWritable {
	return {
		write: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	}
}

afterEach(() => {
	delete (window as any).showSaveFilePicker
	vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('saveToDisk', () => {
	it('uses showSaveFilePicker when available, writes data, closes writable', async () => {
		const writable = makeWritable()
		const picker = stubPicker({ createWritable: () => Promise.resolve(writable) })

		const data = new Blob(['hello'])
		await saveToDisk({ data, filename: 'a.txt' })

		expect(picker).toHaveBeenCalledWith({ suggestedName: 'a.txt' })
		expect(writable.write).toHaveBeenCalledWith(data)
		expect(writable.close).toHaveBeenCalled()
	})

	it('forwards pickerType as types[0] when provided', async () => {
		const writable = makeWritable()
		const picker = stubPicker({ createWritable: () => Promise.resolve(writable) })

		const pickerType = { description: 'PDF Files', accept: { 'application/pdf': ['.pdf'] } }
		await saveToDisk({ data: new Blob(['x']), filename: 'a.pdf', pickerType })

		expect(picker).toHaveBeenCalledWith({ suggestedName: 'a.pdf', types: [pickerType] })
	})

	describe('answers where the file went', () => {
		type OutcomeCase = BaseTestCase & {
			dialog: 'accepted' | 'cancelled' | 'lapsed' | 'none'
			expectedOutcome: SaveOutcome
			expectedWrittenTo: 'file' | 'download' | 'nowhere'
		}
		const testCases: Record<string, OutcomeCase> = {
			'the dialog accepted -> written, to the file chosen': {
				dialog: 'accepted',
				expectedOutcome: 'written',
				expectedWrittenTo: 'file',
			},
			'no dialog in the browser -> downloaded': {
				dialog: 'none',
				expectedOutcome: 'downloaded',
				expectedWrittenTo: 'download',
			},
			'the dialog refused for a lapsed gesture -> downloaded': {
				dialog: 'lapsed',
				expectedOutcome: 'downloaded',
				expectedWrittenTo: 'download',
			},
			'the dialog cancelled -> cancelled, nothing written': {
				dialog: 'cancelled',
				expectedOutcome: 'cancelled',
				expectedWrittenTo: 'nowhere',
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const written = stubDialog({ dialog: testCase.dialog })

			const outcome = await saveToDisk({ data: new Blob(['x']), filename: 'a.txt' })

			expect(outcome).toBe(testCase.expectedOutcome)
			expect(written()).toBe(testCase.expectedWrittenTo)
		})
	})

	describe('a write that fails -> the failure thrown, the chosen file released', () => {
		type FailureCase = BaseTestCase & {
			failing: 'createWritable' | 'write' | 'close'
			error: DOMException
			expectedAborted: boolean
		}
		const testCases: Record<string, FailureCase> = {
			'the file cannot be opened for writing -> thrown, nothing to release': {
				failing: 'createWritable',
				error: new DOMException('locked', 'NoModificationAllowedError'),
				expectedAborted: false,
			},
			'the write aborted -> thrown (no cancel by the user), the writable aborted': {
				failing: 'write',
				error: new DOMException('aborted', 'AbortError'),
				expectedAborted: true,
			},
			'the close fails -> thrown, the writable aborted': {
				failing: 'close',
				error: new DOMException('disk full', 'QuotaExceededError'),
				expectedAborted: true,
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			let aborted = false
			function fail(step: FailureCase['failing']) {
				return async function failing() {
					if (step === testCase.failing) throw testCase.error
				}
			}
			;(window as any).showSaveFilePicker = vi.fn(async function showSaveFilePicker() {
				return {
					createWritable: async () => {
						await fail('createWritable')()
						return {
							write: fail('write'),
							close: fail('close'),
							abort: async () => {
								aborted = true
							},
						}
					},
				}
			})

			await expect(saveToDisk({ data: new Blob(['x']), filename: 'a.txt' })).rejects.toBe(
				testCase.error,
			)
			expect(aborted).toBe(testCase.expectedAborted)
		})
	})

	describe('openSaveTarget: the target opened before the file is made, with where it will go', () => {
		type TargetCase = BaseTestCase & {
			dialog: 'accepted' | 'cancelled' | 'lapsed' | 'none'
			expectedOutcome: SaveOutcome
		}
		const testCases: Record<string, TargetCase> = {
			'the dialog accepted -> a target written to the file chosen': {
				dialog: 'accepted',
				expectedOutcome: 'written',
			},
			'no dialog in the browser -> a download target': {
				dialog: 'none',
				expectedOutcome: 'downloaded',
			},
			'the dialog refused for a lapsed gesture -> a download target': {
				dialog: 'lapsed',
				expectedOutcome: 'downloaded',
			},
			'the dialog cancelled -> a cancelled target, nothing to write to': {
				dialog: 'cancelled',
				expectedOutcome: 'cancelled',
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			stubDialog({ dialog: testCase.dialog })

			const target = await openSaveTarget({ filename: 'a.txt' })

			expect(target).toMatchObject({ outcome: testCase.expectedOutcome })
			expect('write' in target).toBe(testCase.expectedOutcome !== 'cancelled')
		})
	})

	describe('a picker refused for a lapsed user gesture -> the same Blob downloaded', () => {
		type LapsedCase = BaseTestCase & { errorName: string }
		const testCases: Record<string, LapsedCase> = {
			'SecurityError -> downloaded': { errorName: 'SecurityError' },
			'NotAllowedError -> downloaded': { errorName: 'NotAllowedError' },
		}

		runTestCases.generic(testCases, async (testCase) => {
			stubPicker(() => {
				throw new DOMException('the gesture lapsed', testCase.errorName)
			})
			const click = vi.fn()
			const anchor = document.createElement('a')
			anchor.click = click
			vi.spyOn(document, 'createElement').mockReturnValue(anchor)
			const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:lapsed')
			vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
			const data = new Blob(['x'])

			await saveToDisk({ data, filename: 'a.txt' })

			expect(createObjectURL).toHaveBeenCalledWith(data)
			expect(anchor.download).toBe('a.txt')
			expect(click).toHaveBeenCalled()
		})
	})

	it('a picker failing otherwise than by a cancel -> the failure thrown', async () => {
		stubPicker(() => {
			throw new Error('boom')
		})

		await expect(saveToDisk({ data: new Blob(['x']), filename: 'a.txt' })).rejects.toThrow('boom')
	})
})

/** The page's save dialog as the case says, and where a write went: the file chosen, a download, or nowhere. */
function stubDialog(params: {
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
