import { exportBlob } from './export-blob'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { runTestCases } from '@/test'

import type { ProjectExportBlobParams } from '../types'
import type { Store } from '@/store/store.types'
import type { BaseTestCase } from '@/test'
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
function stubSaveDialog(params: { calls: string[]; cancelled?: boolean }): {
	saved: () => Blob | undefined
} {
	const { calls, cancelled } = params
	let written: Blob | undefined
	;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn(
		async function showSaveFilePicker(options: { suggestedName: string }) {
			calls.push(`picker:${options.suggestedName}`)
			if (cancelled) throw new DOMException('cancelled', 'AbortError')
			return {
				createWritable: async () => ({
					write: async (data: Blob) => {
						written = data
					},
					close: async () => {},
				}),
			}
		},
	)
	return { saved: () => written }
}

/** A save target its caller opened before, on a file or cancelled; `written` gets what it was given. */
function fakeTarget(params: { cancelled: boolean }): {
	target: SaveTarget
	written: () => Blob | undefined
} {
	let written: Blob | undefined
	const target: SaveTarget = params.cancelled
		? { outcome: 'cancelled' }
		: {
				outcome: 'written',
				write: async (data: Blob) => {
					written = data
				},
			}
	return { target, written: () => written }
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

	it('a blob not in the store -> BLOB_NOT_FOUND', async () => {
		const thrown = await exportBlob({
			store: blobStore({ calls: [], present: false }),
			request: { blobId: 'missing' },
		}).catch((error: unknown) => error)
		expect(toDialecteError(thrown)?.key).toBe('BLOB_NOT_FOUND')
	})
})
