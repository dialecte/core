import { exportBlob } from './export-blob'

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { saveToDisk } from '@/utils'

import type { Store } from '@/store/store.types'
import type { BlobRecord } from '@/types'

vi.mock('@/utils', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/utils')>()
	return { ...actual, saveToDisk: vi.fn().mockResolvedValue(undefined) }
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<BlobRecord> = {}): BlobRecord {
	return {
		id: 'b1',
		documentId: 'doc-1',
		name: 'diagram.pdf',
		mimeType: 'application/pdf',
		size: 42,
		createdAt: Date.now(),
		attachedTo: [],
		...overrides,
	}
}

function mockStore(result: { entry: BlobRecord; data: Blob } | undefined): Store {
	return { getBlob: vi.fn().mockResolvedValue(result) } as unknown as Store
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('exportBlob', () => {
	beforeEach(() => {
		vi.mocked(saveToDisk).mockClear()
	})

	it('returns entry, data, and filename from store', async () => {
		const entry = makeEntry()
		const data = new Blob(['x'], { type: 'application/pdf' })
		const store = mockStore({ entry, data })

		const result = await exportBlob({ blobId: 'b1', store })

		expect(result).toEqual({ entry, data, filename: 'diagram.pdf' })
		expect(store.getBlob).toHaveBeenCalledWith('b1')
	})

	it('does not call saveToDisk when withDownload is absent', async () => {
		const entry = makeEntry()
		const data = new Blob(['x'])
		const store = mockStore({ entry, data })

		await exportBlob({ blobId: 'b1', store })

		expect(saveToDisk).not.toHaveBeenCalled()
	})

	it('calls saveToDisk with data + filename when withDownload is true', async () => {
		const entry = makeEntry({ name: 'report.csv' })
		const data = new Blob(['hello'])
		const store = mockStore({ entry, data })

		await exportBlob({ blobId: 'b1', store, options: { withDownload: true } })

		expect(saveToDisk).toHaveBeenCalledWith({ data, filename: 'report.csv' })
	})

	it('missing blob -> throws BLOB_NOT_FOUND', async () => {
		const store = mockStore(undefined)

		await expect(exportBlob({ blobId: 'missing', store })).rejects.toThrow(/not found/i)
	})
})
