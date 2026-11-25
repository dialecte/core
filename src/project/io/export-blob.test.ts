import { exportBlob } from './export-blob'

import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { runTestCases } from '@/test'

import type { ProjectExportBlobParams } from '../types'
import type { Project } from '@/project'
import type { Store } from '@/store/store.types'
import type { BaseTestCase, TestDialecteConfig } from '@/test'
import type { BlobRecord } from '@/types'
import type { SaveOutcome, SaveTarget } from '@/utils/save-to-disk.types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(): BlobRecord {
	return {
		id: 'b1',
		documentId: 'doc-1',
		name: 'diagram.pdf',
		mimeType: 'application/pdf',
		size: 42,
		createdAt: 0,
		attachedTo: [],
	}
}

const DATA = new Blob(['x'], { type: 'application/pdf' })

/** A store holding blob `b1` (or none); `calls` gets `read` when it is read. */
function blobStore(params: { calls: string[]; present?: boolean }): Store {
	const { calls, present = true } = params
	return {
		getBlob: vi.fn(async function getBlob() {
			calls.push('read')
			return present ? { entry: makeEntry(), data: DATA } : undefined
		}),
	} as unknown as Store
}

/**
 * A save dialog whose writable keeps what is written; `calls` gets `picker:<suggested name>` when it opens. `cancelled`
 * makes the user cancel it.
 */
function stubSaveDialog(params: { calls: string[]; cancelled?: boolean; failWrite?: Error }): {
	saved: () => Blob | undefined
	removed: () => boolean
} {
	const { calls, cancelled, failWrite } = params
	let written: Blob | undefined
	let removed = false
	;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn(
		async function showSaveFilePicker(options: { suggestedName: string }) {
			calls.push(`picker:${options.suggestedName}`)
			if (cancelled) throw new DOMException('cancelled', 'AbortError')
			return {
				getFile: async () => new File([], options.suggestedName),
				createWritable: async () => ({
					abort: async () => {},
					write: async (data: Blob) => {
						if (failWrite) throw failWrite
						written = data
					},
					close: async () => {},
				}),
				remove: async () => {
					removed = true
				},
			}
		},
	)
	return { saved: () => written, removed: () => removed }
}

/** A save target its caller opened before, on a file or cancelled; `written` gets what it was given. */
function fakeTarget(params: { cancelled: boolean; failWrite?: Error }): {
	target: SaveTarget
	written: () => Blob | undefined
	discarded: () => boolean
} {
	let written: Blob | undefined
	let discarded = false
	async function discard() {
		discarded = true
	}
	const target: SaveTarget = params.cancelled
		? { outcome: 'cancelled', discard }
		: {
				outcome: 'written',
				write: async (data: Blob) => {
					if (params.failWrite) throw params.failWrite
					written = data
				},
				discard,
			}
	return { target, written: () => written, discarded: () => discarded }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('exportBlob', () => {
	afterEach(() => {
		delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
	})

	type BlobCase = BaseTestCase & {
		request: Omit<ProjectExportBlobParams, 'download'> & {
			download?: ProjectExportBlobParams['download'] | 'a target' | 'a cancelled target'
		}
		cancelled?: boolean
		expectedCalls: string[]
		expectedSaved: SaveOutcome | 'not answered'
		expectedWrittenTo: 'dialog' | 'target' | 'nowhere'
	}

	const testCases: Record<string, BlobCase> = {
		'no download -> the blob read, nothing saved, no saved answered': {
			request: { blobId: 'b1' },
			expectedCalls: ['read'],
			expectedSaved: 'not answered',
			expectedWrittenTo: 'nowhere',
		},
		'a download -> the blob read, then saved under its name, written': {
			request: { blobId: 'b1', download: true },
			expectedCalls: ['read', 'picker:diagram.pdf'],
			expectedSaved: 'written',
			expectedWrittenTo: 'dialog',
		},
		'a download under another filename -> the dialog opened first, then the blob read and saved, written':
			{
				request: { blobId: 'b1', download: { filename: 'copy.pdf' } },
				expectedCalls: ['picker:copy.pdf', 'read'],
				expectedSaved: 'written',
				expectedWrittenTo: 'dialog',
			},
		'a download whose dialog is cancelled -> the blob read, nothing written, cancelled': {
			request: { blobId: 'b1', download: true },
			cancelled: true,
			expectedCalls: ['read', 'picker:diagram.pdf'],
			expectedSaved: 'cancelled',
			expectedWrittenTo: 'nowhere',
		},
		'a target opened before -> no dialog of its own, the blob written to it': {
			request: { blobId: 'b1', download: 'a target' },
			expectedCalls: ['read'],
			expectedSaved: 'written',
			expectedWrittenTo: 'target',
		},
		'a cancelled target -> the blob read, nothing written, cancelled': {
			request: { blobId: 'b1', download: 'a cancelled target' },
			expectedCalls: ['read'],
			expectedSaved: 'cancelled',
			expectedWrittenTo: 'nowhere',
		},
	}

	runTestCases.generic(testCases, async (testCase) => {
		const calls: string[] = []
		const dialog = stubSaveDialog({ calls, cancelled: testCase.cancelled })
		const target = fakeTarget({ cancelled: testCase.request.download === 'a cancelled target' })
		const { download, ...rest } = testCase.request
		const request: ProjectExportBlobParams =
			download === 'a target' || download === 'a cancelled target'
				? { ...rest, download: { target: target.target } }
				: { ...rest, download }

		const result = await exportBlob({ store: blobStore({ calls }), request })

		expect(calls).toEqual(testCase.expectedCalls)
		const { saved, ...exported } = result
		expect(exported).toEqual({ entry: makeEntry(), data: DATA, filename: 'diagram.pdf' })
		expect('saved' in result ? saved : 'not answered').toBe(testCase.expectedSaved)
		const writtenTo = [dialog.saved() && 'dialog', target.written() && 'target'].filter(Boolean)
		expect(writtenTo).toEqual(
			testCase.expectedWrittenTo === 'nowhere' ? [] : [testCase.expectedWrittenTo],
		)
	})

	it('the result type -> saved typed present exactly when a download is asked', () => {
		// checked by the type-check of the tests; never called
		async function typed(params: { project: Project<TestDialecteConfig>; target: SaveTarget }) {
			const { project, target } = params
			const saved = await project.exportBlob({ blobId: 'b1', download: true })
			expectTypeOf(saved.saved).toEqualTypeOf<SaveOutcome>()
			const toTarget = await project.exportBlob({ blobId: 'b1', download: { target } })
			expectTypeOf(toTarget.saved).toEqualTypeOf<SaveOutcome>()
			const notSaved = await project.exportBlob({ blobId: 'b1' })
			expectTypeOf(notSaved).not.toHaveProperty('saved')
			// @ts-expect-error a filename and a target together
			await project.exportBlob({ blobId: 'b1', download: { filename: 'copy.pdf', target } })
		}
		expect(typed).toBeTypeOf('function')
	})

	describe('a blob not in the store after the save was asked -> BLOB_NOT_FOUND, the dialog it opened discarded', () => {
		type FailedCase = BaseTestCase & {
			download: 'a filename' | 'a target'
			expectedDiscarded: boolean
		}
		const testCases: Record<string, FailedCase> = {
			'the dialog opened first for another filename -> the file it created removed': {
				download: 'a filename',
				expectedDiscarded: true,
			},
			'a target the caller opened -> left to the caller, not discarded': {
				download: 'a target',
				expectedDiscarded: false,
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const calls: string[] = []
			const dialog = stubSaveDialog({ calls })
			const target = fakeTarget({ cancelled: false })
			const download =
				testCase.download === 'a target' ? { target: target.target } : { filename: 'copy.pdf' }

			const thrown = await exportBlob({
				store: blobStore({ calls, present: false }),
				request: { blobId: 'missing', download },
			}).catch((error: unknown) => error)

			expect(toDialecteError(thrown)?.key).toBe('BLOB_NOT_FOUND')
			expect(dialog.removed() || target.discarded()).toBe(testCase.expectedDiscarded)
		})
	})

	describe('a write failing -> the failure thrown, the dialog the export opened discarded', () => {
		type WriteFailedCase = BaseTestCase & {
			download: 'its name' | 'a filename' | 'a target'
			expectedDiscarded: boolean
		}
		const testCases: Record<string, WriteFailedCase> = {
			"the dialog opened for the blob's name -> the file left empty removed": {
				download: 'its name',
				expectedDiscarded: true,
			},
			'the dialog opened first for another filename -> the file left empty removed': {
				download: 'a filename',
				expectedDiscarded: true,
			},
			'a target the caller opened -> left to the caller, not discarded': {
				download: 'a target',
				expectedDiscarded: false,
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const calls: string[] = []
			const failWrite = new DOMException('disk full', 'QuotaExceededError')
			const dialog = stubSaveDialog({ calls, failWrite })
			const target = fakeTarget({ cancelled: false, failWrite })
			const download =
				testCase.download === 'a target'
					? { target: target.target }
					: testCase.download === 'a filename'
						? { filename: 'copy.pdf' }
						: true

			const exported = exportBlob({
				store: blobStore({ calls }),
				request: { blobId: 'b1', download },
			})

			await expect(exported).rejects.toBe(failWrite)
			expect(dialog.removed() || target.discarded()).toBe(testCase.expectedDiscarded)
		})
	})

	it('a blob not in the store -> BLOB_NOT_FOUND', async () => {
		const thrown = await exportBlob({
			store: blobStore({ calls: [], present: false }),
			request: { blobId: 'missing' },
		}).catch((error: unknown) => error)
		expect(toDialecteError(thrown)?.key).toBe('BLOB_NOT_FOUND')
	})
})
