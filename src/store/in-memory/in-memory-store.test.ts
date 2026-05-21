import { InMemoryStore } from './in-memory-store'

import { describe, it, expect, beforeEach } from 'vitest'

import type { DocumentRecord } from '@/project/types'
import type { AnyRawRecord } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDocument(id = 'doc-1'): DocumentRecord {
	return {
		id,
		name: 'test-doc',
		extension: '.scd',
		configKey: 'scl',
		createdAt: Date.now(),
	}
}

function makeRecord(id: string, tagName = 'LNode'): AnyRawRecord {
	return {
		id,
		tagName,
		parent: { id: 'root', tagName: 'SCL' },
		children: [],
		attributes: [{ name: 'inst', value: '1' }],
	} as unknown as AnyRawRecord
}

// ── Writable Store ───────────────────────────────────────────────────────────

describe('InMemoryStore (writable)', () => {
	let store: InMemoryStore

	beforeEach(() => {
		store = new InMemoryStore('test', { writable: true })
	})

	describe('lifecycle', () => {
		it('open/close are no-ops', async () => {
			await expect(store.open()).resolves.toBeUndefined()
			expect(() => store.close()).not.toThrow()
		})

		it('destroy clears all data', async () => {
			await store.registerDocument(makeDocument())
			await store.destroy()
			expect(await store.getDocuments()).toEqual([])
		})
	})

	describe('document registry', () => {
		it('registers and retrieves a document', async () => {
			const doc = makeDocument()
			await store.registerDocument(doc)
			expect(await store.getDocument('doc-1')).toEqual(doc)
		})

		it('lists all documents', async () => {
			await store.registerDocument(makeDocument('a'))
			await store.registerDocument(makeDocument('b'))
			expect(await store.getDocuments()).toHaveLength(2)
		})

		it('updates document metadata', async () => {
			await store.registerDocument(makeDocument())
			await store.updateDocument('doc-1', { name: 'renamed' })
			expect((await store.getDocument('doc-1'))?.name).toBe('renamed')
		})

		it('removes a document and its records', async () => {
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { creates: [makeRecord('r1')] })
			await store.removeDocument('doc-1')
			expect(await store.getDocument('doc-1')).toBeUndefined()
			expect(await store.getByDocumentId('doc-1')).toEqual([])
		})
	})

	describe('record access', () => {
		beforeEach(async () => {
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', {
				creates: [makeRecord('r1', 'LNode'), makeRecord('r2', 'Bay')],
			})
		})

		it('get by id + documentId', async () => {
			const record = await store.get('r1', 'doc-1')
			expect(record?.id).toBe('r1')
		})

		it('get by id cross-document', async () => {
			const record = await store.get('r1')
			expect(record?.id).toBe('r1')
		})

		it('returns undefined for unknown id', async () => {
			expect(await store.get('unknown', 'doc-1')).toBeUndefined()
		})

		it('getByDocumentId returns all records', async () => {
			expect(await store.getByDocumentId('doc-1')).toHaveLength(2)
		})

		it('getByTagNameInDocument filters', async () => {
			const results = await store.getByTagNameInDocument('Bay', 'doc-1')
			expect(results).toHaveLength(1)
			expect(results[0].tagName).toBe('Bay')
		})
	})

	describe('commit + undo/redo', () => {
		beforeEach(async () => {
			await store.registerDocument(makeDocument())
		})

		it('commit persists creates', async () => {
			await store.commit({
				documentId: 'doc-1',
				creates: [makeRecord('r1')],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})
			expect(await store.get('r1', 'doc-1')).toBeDefined()
		})

		it('undo reverts a commit', async () => {
			await store.commit({
				documentId: 'doc-1',
				creates: [makeRecord('r1')],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})
			await store.undo('doc-1')
			expect(await store.get('r1', 'doc-1')).toBeUndefined()
		})

		it('redo re-applies after undo', async () => {
			await store.commit({
				documentId: 'doc-1',
				creates: [makeRecord('r1')],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})
			await store.undo('doc-1')
			await store.redo('doc-1')
			expect(await store.get('r1', 'doc-1')).toBeDefined()
		})

		it('undo at head=0 is no-op', async () => {
			await expect(store.undo('doc-1')).resolves.toBeUndefined()
		})

		it('redo with no future is no-op', async () => {
			await expect(store.redo('doc-1')).resolves.toBeUndefined()
		})
	})

	describe('changelog', () => {
		it('getChangeLog returns entries', async () => {
			await store.registerDocument(makeDocument())
			await store.commit({
				documentId: 'doc-1',
				creates: [makeRecord('r1')],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})
			const log = await store.getChangeLog('doc-1')
			expect(log).toHaveLength(1)
			expect(log[0].sequenceNumber).toBe(1)
		})
	})

	describe('getDatabaseInstance', () => {
		it('returns null', () => {
			expect(store.getDatabaseInstance()).toBeNull()
		})
	})
})

// ── Non-Writable Store ───────────────────────────────────────────────────────

describe('InMemoryStore (non-writable)', () => {
	let store: InMemoryStore

	beforeEach(() => {
		store = new InMemoryStore('test-readonly', { writable: false })
	})

	it('reads return empty', async () => {
		expect(await store.getDocuments()).toEqual([])
		expect(await store.getByDocumentId('any')).toEqual([])
		expect(await store.get('any')).toBeUndefined()
		expect(await store.getByTagNameInDocument('X', 'any')).toEqual([])
		expect(await store.getChangeLog('any')).toEqual([])
	})

	const writeMethods = [
		['registerDocument', () => store.registerDocument(makeDocument())],
		['updateDocument', () => store.updateDocument('x', { name: 'y' })],
		['removeDocument', () => store.removeDocument('x')],
		['bulkWrite', () => store.bulkWrite('x', { creates: [makeRecord('r1')] })],
		[
			'commit',
			() =>
				store.commit({
					documentId: 'x',
					creates: [makeRecord('r1')],
					updates: [],
					deletes: [],
					onProgress: () => {},
				}),
		],
		['undo', () => store.undo('x')],
		['redo', () => store.redo('x')],
	] as const

	it.each(writeMethods)('%s throws STORE_NOT_WRITABLE', async (_name, fn) => {
		await expect(fn()).rejects.toThrow(/read-only/i)
	})
})
