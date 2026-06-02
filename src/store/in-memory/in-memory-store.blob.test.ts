import { InMemoryStore } from './in-memory-store'

import { describe, it, expect, beforeEach } from 'vitest'

import type { DocumentRecord } from '@/project/types'
import type { BlobRecord } from '@/types'

function makeDocument(id = 'doc-1'): DocumentRecord {
	return {
		id,
		name: 'test-doc',
		extension: '.scd',
		configKey: 'scl',
		createdAt: Date.now(),
	}
}

function makeBlobEntry(overrides: Partial<BlobRecord> = {}): BlobRecord {
	return {
		id: overrides.id ?? crypto.randomUUID(),
		documentId: overrides.documentId ?? 'doc-1',
		name: overrides.name ?? 'file.bin',
		mimeType: overrides.mimeType,
		size: overrides.size,
		createdAt: overrides.createdAt ?? Date.now(),
		attachedTo: overrides.attachedTo ?? [],
	}
}

describe('InMemoryStore - blobs', () => {
	let store: InMemoryStore

	beforeEach(async () => {
		store = new InMemoryStore('blob-test', { writable: true })
		await store.registerDocument(makeDocument('doc-1'))
		await store.registerDocument(makeDocument('doc-2'))
	})

	it('addBlob + getBlob round-trip preserves data', async () => {
		const entry = makeBlobEntry({ name: 'a.txt' })
		const data = new Blob(['hello'], { type: 'text/plain' })
		await store.addBlob(entry, data)

		const result = await store.getBlob(entry.id)
		expect(result?.entry).toEqual(entry)
		expect(await result?.data.text()).toBe('hello')
	})

	it('addBlob rejects when owner document is not registered', async () => {
		const entry = makeBlobEntry({ documentId: 'missing' })
		await expect(store.addBlob(entry, new Blob(['x']))).rejects.toThrow(/not registered/)
	})

	it('getBlobsByDocument filters by attachedTo, not by storage owner', async () => {
		const attached = makeBlobEntry({
			id: 'b1',
			documentId: 'doc-1',
			attachedTo: [{ documentId: 'doc-2', recordRef: 'r1' }],
		})
		const standalone = makeBlobEntry({ id: 'b2', documentId: 'doc-1' })
		await store.addBlob(attached, new Blob(['1']))
		await store.addBlob(standalone, new Blob(['2']))

		const doc2Blobs = await store.getBlobsByDocument('doc-2')
		expect(doc2Blobs.map((b) => b.id)).toEqual(['b1'])

		const doc1Blobs = await store.getBlobsByDocument('doc-1')
		expect(doc1Blobs).toEqual([])
	})

	it('getBlobsByRecord filters on documentId + recordRef', async () => {
		const blob = makeBlobEntry({
			id: 'b1',
			attachedTo: [
				{ documentId: 'doc-2', recordRef: 'r1' },
				{ documentId: 'doc-2', recordRef: 'r2' },
			],
		})
		await store.addBlob(blob, new Blob(['x']))

		expect((await store.getBlobsByRecord('doc-2', 'r1')).map((b) => b.id)).toEqual(['b1'])
		expect(await store.getBlobsByRecord('doc-2', 'r3')).toEqual([])
	})

	it('getStandaloneBlobs returns only blobs with empty attachedTo', async () => {
		const standalone = makeBlobEntry({ id: 'b1' })
		const attached = makeBlobEntry({
			id: 'b2',
			attachedTo: [{ documentId: 'doc-2', recordRef: 'r1' }],
		})
		await store.addBlob(standalone, new Blob(['1']))
		await store.addBlob(attached, new Blob(['2']))

		expect((await store.getStandaloneBlobs()).map((b) => b.id)).toEqual(['b1'])
	})

	it('attachBlob is idempotent on identical refs', async () => {
		const blob = makeBlobEntry({ id: 'b1' })
		await store.addBlob(blob, new Blob(['x']))

		const ref = { documentId: 'doc-2', recordRef: 'r1' }
		await store.attachBlob('b1', ref)
		await store.attachBlob('b1', ref)

		const result = await store.getBlob('b1')
		expect(result?.entry.attachedTo).toEqual([ref])
	})

	it('detachBlob removes all refs matching documentId + recordRef', async () => {
		const blob = makeBlobEntry({
			id: 'b1',
			attachedTo: [
				{ documentId: 'doc-2', recordRef: 'r1', attribute: 'a1' },
				{ documentId: 'doc-2', recordRef: 'r1', attribute: 'a2' },
				{ documentId: 'doc-2', recordRef: 'r2' },
			],
		})
		await store.addBlob(blob, new Blob(['x']))

		await store.detachBlob('b1', { documentId: 'doc-2', recordRef: 'r1' })
		const result = await store.getBlob('b1')
		expect(result?.entry.attachedTo).toEqual([{ documentId: 'doc-2', recordRef: 'r2' }])
	})

	it('removeBlob removes registry entry and data', async () => {
		const blob = makeBlobEntry({ id: 'b1' })
		await store.addBlob(blob, new Blob(['x']))

		await store.removeBlob('b1')
		expect(await store.getBlob('b1')).toBeUndefined()
		expect(await store.getStandaloneBlobs()).toEqual([])
	})

	it('removeDocument cascades: drops owner blobs from registry + data', async () => {
		const owned = makeBlobEntry({ id: 'b1', documentId: 'doc-1' })
		const otherOwner = makeBlobEntry({ id: 'b2', documentId: 'doc-2' })
		await store.addBlob(owned, new Blob(['1']))
		await store.addBlob(otherOwner, new Blob(['2']))

		await store.removeDocument('doc-1')

		expect(await store.getBlob('b1')).toBeUndefined()
		const stillThere = await store.getBlob('b2')
		expect(stillThere?.entry.id).toBe('b2')
	})

	it('attachBlob/detachBlob/removeBlob/addBlob throw on read-only store', async () => {
		const ro = new InMemoryStore('ro', { writable: false })
		await expect(ro.addBlob(makeBlobEntry(), new Blob(['x']))).rejects.toThrow()
		await expect(ro.attachBlob('b1', { documentId: 'd', recordRef: 'r' })).rejects.toThrow()
		await expect(ro.detachBlob('b1', { documentId: 'd', recordRef: 'r' })).rejects.toThrow()
		await expect(ro.removeBlob('b1')).rejects.toThrow()
	})
})
