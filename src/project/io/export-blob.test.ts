import { exportBlob } from './export-blob'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { runTestCases } from '@/test'

import type { ProjectExportBlobParams } from '../types'
import type { Store } from '@/store/store.types'
import type { BaseTestCase } from '@/test'
import type { BlobRecord } from '@/types'

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

/** A save dialog whose writable keeps what is written; `calls` gets `picker:<suggested name>` when it opens. */
function stubSaveDialog(params: { calls: string[] }): { saved: () => Blob | undefined } {
	const { calls } = params
	let written: Blob | undefined
	;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn(
		async function showSaveFilePicker(options: { suggestedName: string }) {
			calls.push(`picker:${options.suggestedName}`)
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('exportBlob', () => {
	afterEach(() => {
		delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
	})

	type BlobCase = BaseTestCase & {
		request: ProjectExportBlobParams
		expectedCalls: string[]
		expectedSaved: boolean
	}

	const testCases: Record<string, BlobCase> = {
		'no download -> the blob read, nothing saved': {
			request: { blobId: 'b1' },
			expectedCalls: ['read'],
			expectedSaved: false,
		},
		'a download -> the blob read, then saved under its name': {
			request: { blobId: 'b1', download: true },
			expectedCalls: ['read', 'picker:diagram.pdf'],
			expectedSaved: true,
		},
		'a download under another filename -> the dialog opened first, then the blob read and saved': {
			request: { blobId: 'b1', download: { filename: 'copy.pdf' } },
			expectedCalls: ['picker:copy.pdf', 'read'],
			expectedSaved: true,
		},
	}

	runTestCases.generic(testCases, async (testCase) => {
		const calls: string[] = []
		const dialog = stubSaveDialog({ calls })
		const result = await exportBlob({ store: blobStore({ calls }), request: testCase.request })

		expect(calls).toEqual(testCase.expectedCalls)
		expect(result).toEqual({ entry: makeEntry(), data: DATA, filename: 'diagram.pdf' })
		expect(dialog.saved()).toBe(testCase.expectedSaved ? DATA : undefined)
	})

	it('a blob not in the store -> BLOB_NOT_FOUND', async () => {
		const thrown = await exportBlob({
			store: blobStore({ calls: [], present: false }),
			request: { blobId: 'missing' },
		}).catch((error: unknown) => error)
		expect(toDialecteError(thrown)?.key).toBe('BLOB_NOT_FOUND')
	})
})
