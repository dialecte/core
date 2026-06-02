import { DexieStore } from './dexie-store'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DocumentRecord } from '@/project/types'
import type { BlobRecord } from '@/types'

const DB_PREFIX = 'test-dexie-blobs'

function uniqueName() {
	return `${DB_PREFIX}-${crypto.randomUUID()}`
}

function makeDoc(id?: string): DocumentRecord {
	return {
		id: id ?? crypto.randomUUID(),
		name: 'test',
		extension: '.scd',
		configKey: 'scl',
		createdAt: Date.now(),
	}
}

function makeBlobEntry(overrides: Partial<BlobRecord> & { documentId: string }): BlobRecord {
	return {
		id: overrides.id ?? crypto.randomUUID(),
		documentId: overrides.documentId,
		name: overrides.name ?? 'file.bin',
		mimeType: overrides.mimeType,
		size: overrides.size,
		createdAt: overrides.createdAt ?? Date.now(),
		attachedTo: overrides.attachedTo ?? [],
	}
}

describe('DexieStore - blobs', () => {
	let store: DexieStore
	let doc1: DocumentRecord
	let doc2: DocumentRecord

	beforeEach(async () => {
		store = new DexieStore(uniqueName())
		await store.open()
		doc1 = makeDoc()
		doc2 = makeDoc()
		await store.registerDocument(doc1)
		await store.registerDocument(doc2)
	})

	afterEach(async () => {
		await store.destroy()
	})

	it('addBlob + getBlob round-trip preserves binary data', async () => {
		const entry = makeBlobEntry({ documentId: doc1.id, name: 'a.txt' })
		const data = new Blob(['hello'], { type: 'text/plain' })
		await store.addBlob(entry, data)

		const result = await store.getBlob(entry.id)
		expect(result?.entry).toEqual(entry)
		expect(await result?.data.text()).toBe('hello')
	})

	it('addBlob throws if owner document is not registered', async () => {
		const entry = makeBlobEntry({ documentId: 'unknown' })
		await expect(store.addBlob(entry, new Blob(['x']))).rejects.toThrow(/not registered/)
	})

	it('getBlobsByDocument returns blobs referencing the document via attachedTo', async () => {
		const referenced = makeBlobEntry({
			documentId: doc1.id,
			attachedTo: [{ documentId: doc2.id, recordRef: 'r1' }],
		})
		const standalone = makeBlobEntry({ documentId: doc1.id })
		await store.addBlob(referenced, new Blob(['1']))
		await store.addBlob(standalone, new Blob(['2']))

		const byDoc2 = await store.getBlobsByDocument(doc2.id)
		expect(byDoc2.map((b) => b.id)).toEqual([referenced.id])
		expect(await store.getBlobsByDocument(doc1.id)).toEqual([])
	})

	it('getBlobsByRecord filters by documentId + recordRef', async () => {
		const blob = makeBlobEntry({
			documentId: doc1.id,
			attachedTo: [
				{ documentId: doc2.id, recordRef: 'r1' },
				{ documentId: doc2.id, recordRef: 'r2' },
			],
		})
		await store.addBlob(blob, new Blob(['x']))

		expect((await store.getBlobsByRecord(doc2.id, 'r1')).map((b) => b.id)).toEqual([blob.id])
		expect(await store.getBlobsByRecord(doc2.id, 'unknown')).toEqual([])
	})

	it('getStandaloneBlobs returns only blobs with empty attachedTo', async () => {
		const standalone = makeBlobEntry({ documentId: doc1.id })
		const attached = makeBlobEntry({
			documentId: doc1.id,
			attachedTo: [{ documentId: doc2.id, recordRef: 'r1' }],
		})
		await store.addBlob(standalone, new Blob(['1']))
		await store.addBlob(attached, new Blob(['2']))

		expect((await store.getStandaloneBlobs()).map((b) => b.id)).toEqual([standalone.id])
	})

	it('attachBlob is idempotent', async () => {
		const blob = makeBlobEntry({ documentId: doc1.id })
		await store.addBlob(blob, new Blob(['x']))

		const ref = { documentId: doc2.id, recordRef: 'r1' }
		await store.attachBlob(blob.id, ref)
		await store.attachBlob(blob.id, ref)

		const result = await store.getBlob(blob.id)
		expect(result?.entry.attachedTo).toEqual([ref])
	})

	it('detachBlob removes matching documentId + recordRef refs', async () => {
		const blob = makeBlobEntry({
			documentId: doc1.id,
			attachedTo: [
				{ documentId: doc2.id, recordRef: 'r1', attribute: 'a1' },
				{ documentId: doc2.id, recordRef: 'r1', attribute: 'a2' },
				{ documentId: doc2.id, recordRef: 'r2' },
			],
		})
		await store.addBlob(blob, new Blob(['x']))

		await store.detachBlob(blob.id, { documentId: doc2.id, recordRef: 'r1' })
		const result = await store.getBlob(blob.id)
		expect(result?.entry.attachedTo).toEqual([{ documentId: doc2.id, recordRef: 'r2' }])
	})

	it('removeBlob removes registry entry and binary', async () => {
		const blob = makeBlobEntry({ documentId: doc1.id })
		await store.addBlob(blob, new Blob(['x']))

		await store.removeBlob(blob.id)
		expect(await store.getBlob(blob.id)).toBeUndefined()
		expect(await store.getStandaloneBlobs()).toEqual([])
	})

	it('removeDocument cascades: drops owner blobs from registry + binary table', async () => {
		const owned = makeBlobEntry({ id: 'b1', documentId: doc1.id })
		const otherOwner = makeBlobEntry({ id: 'b2', documentId: doc2.id })
		await store.addBlob(owned, new Blob(['1']))
		await store.addBlob(otherOwner, new Blob(['2']))

		await store.removeDocument(doc1.id)

		expect(await store.getBlob('b1')).toBeUndefined()
		const stillThere = await store.getBlob('b2')
		expect(stillThere?.entry.id).toBe('b2')
	})
})
