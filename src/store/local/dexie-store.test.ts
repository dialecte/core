import { DexieStore, buildDexieSchema } from './dexie-store'

import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import type { RecordSchema } from '../store.types'
import type { DocumentRecord } from '@/types/document-record'
import type { AnyRawRecord } from '@/types/records'

describe('buildDexieSchema', () => {
	it('builds minimal schema', () => {
		const schema: RecordSchema = {
			primaryKey: 'id',
			indexes: ['tagName'],
			compoundIndexes: [],
			arrayIndexes: [],
		}
		expect(buildDexieSchema(schema)).toBe('id, tagName')
	})

	it('builds full SCL schema', () => {
		const schema: RecordSchema = {
			primaryKey: 'id',
			indexes: ['tagName', 'parent.id', 'parent.tagName'],
			compoundIndexes: [['id', 'tagName']],
			arrayIndexes: ['children.id', 'children.tagName'],
		}
		expect(buildDexieSchema(schema)).toBe(
			'id, tagName, parent.id, parent.tagName, [id+tagName], *children.id, *children.tagName',
		)
	})

	it('builds auto-increment schema', () => {
		const schema: RecordSchema = {
			primaryKey: 'id',
			autoIncrement: true,
			indexes: ['documentId'],
			compoundIndexes: [['documentId', 'sequenceNumber']],
			arrayIndexes: [],
		}
		expect(buildDexieSchema(schema)).toBe('++id, documentId, [documentId+sequenceNumber]')
	})
})

const DB_PREFIX = 'test-dexie-store'

function uniqueName() {
	return `${DB_PREFIX}-${crypto.randomUUID()}`
}

function makeFile(overrides?: Partial<DocumentRecord>): DocumentRecord {
	return {
		id: crypto.randomUUID(),
		name: 'test-file',
		extension: '.scd',
		configKey: 'scl',
		createdAt: Date.now(),
		...overrides,
	}
}

function makeRecord(overrides?: Partial<AnyRawRecord>): AnyRawRecord {
	return {
		id: crypto.randomUUID(),
		tagName: 'LNode',
		parentId: null,
		...overrides,
	} as AnyRawRecord
}

describe('DexieStore', () => {
	let store: DexieStore

	beforeEach(async () => {
		store = new DexieStore(uniqueName())
		await store.open()
	})

	afterEach(async () => {
		await store.destroy()
	})

	describe('lifecycle', () => {
		it('opens and closes without error', () => {
			store.close()
			// No throw = pass
		})

		it('destroy removes the database', async () => {
			const name = store.name
			await store.destroy()
			// Verify DB is gone by trying to open it fresh
			const check = new Dexie(name)
			check.version(1).stores({ _test: 'id' })
			await check.open()
			expect(check.tables.map((t) => t.name)).not.toContain('_documents')
			check.close()
			await Dexie.delete(name)
		})

		it('accepts custom RecordSchema from dialecte config', async () => {
			const customStore = new DexieStore(uniqueName(), {
				recordSchema: {
					primaryKey: 'id',
					indexes: ['tagName', 'parent.id', 'parent.tagName'],
					compoundIndexes: [['id', 'tagName']],
					arrayIndexes: ['children.id', 'children.tagName'],
				},
			})
			await customStore.open()
			const file = makeFile()
			await customStore.registerDocument(file)
			const rec = makeRecord()
			await customStore.bulkWrite(file.id, { creates: [rec] })
			const result = await customStore.get(rec.id, file.id)
			expect(result?.id).toBe(rec.id)
			await customStore.destroy()
		})
	})

	describe('file registry', () => {
		it('registerDocument + getDocument', async () => {
			const file = makeFile()
			await store.registerDocument(file)

			const retrieved = await store.getDocument(file.id)
			expect(retrieved).toEqual(file)
		})

		it('getDocuments returns all registered files', async () => {
			const f1 = makeFile({ name: 'file1' })
			const f2 = makeFile({ name: 'file2' })
			await store.registerDocument(f1)
			await store.registerDocument(f2)

			const files = await store.getDocuments()
			expect(files).toHaveLength(2)
			expect(files.map((f) => f.id).sort()).toEqual([f1.id, f2.id].sort())
		})

		it('updateDocument modifies metadata', async () => {
			const file = makeFile()
			await store.registerDocument(file)

			await store.updateDocument(file.id, { name: 'renamed' })
			const updated = await store.getDocument(file.id)
			expect(updated?.name).toBe('renamed')
		})

		it('removeDocument removes file and its records', async () => {
			const file = makeFile()
			await store.registerDocument(file)
			const rec = makeRecord()
			await store.bulkWrite(file.id, { creates: [rec] })

			await store.removeDocument(file.id)

			const retrieved = await store.getDocument(file.id)
			expect(retrieved).toBeUndefined()
			const files = await store.getDocuments()
			expect(files).toHaveLength(0)
		})
	})

	describe('record access', () => {
		let documentId: string

		beforeEach(async () => {
			const file = makeFile()
			await store.registerDocument(file)
			documentId = file.id
		})

		it('bulkWrite + getByDocumentId', async () => {
			const records = [makeRecord(), makeRecord(), makeRecord()]
			await store.bulkWrite(documentId, { creates: records })

			const result = await store.getByDocumentId(documentId)
			expect(result).toHaveLength(3)
		})

		it('get with documentId', async () => {
			const rec = makeRecord()
			await store.bulkWrite(documentId, { creates: [rec] })

			const result = await store.get(rec.id, documentId)
			expect(result?.id).toBe(rec.id)
		})

		it('get without documentId (cross-file lookup)', async () => {
			const rec = makeRecord()
			await store.bulkWrite(documentId, { creates: [rec] })

			const result = await store.get(rec.id)
			expect(result?.id).toBe(rec.id)
		})

		it('getByTagNameInFile filters by tagName', async () => {
			const r1 = makeRecord({ tagName: 'LNode' })
			const r2 = makeRecord({ tagName: 'Bay' })
			const r3 = makeRecord({ tagName: 'LNode' })
			await store.bulkWrite(documentId, { creates: [r1, r2, r3] })

			const lnodes = await store.getByTagNameInDocument('LNode', documentId)
			expect(lnodes).toHaveLength(2)
			expect(lnodes.every((r) => r.tagName === 'LNode')).toBe(true)
		})

		it('records are isolated between files', async () => {
			const file2 = makeFile({ name: 'other' })
			await store.registerDocument(file2)

			const r1 = makeRecord({ tagName: 'Bay' })
			const r2 = makeRecord({ tagName: 'Bay' })
			await store.bulkWrite(documentId, { creates: [r1] })
			await store.bulkWrite(file2.id, { creates: [r2] })

			const fromFile1 = await store.getByDocumentId(documentId)
			const fromFile2 = await store.getByDocumentId(file2.id)
			expect(fromFile1).toHaveLength(1)
			expect(fromFile2).toHaveLength(1)
			expect(fromFile1[0].id).toBe(r1.id)
			expect(fromFile2[0].id).toBe(r2.id)
		})
	})

	describe('commit + undo/redo', () => {
		let documentId: string

		beforeEach(async () => {
			const file = makeFile()
			await store.registerDocument(file)
			documentId = file.id
		})

		it('commit creates records', async () => {
			const rec = makeRecord()
			await store.commit({
				documentId,
				creates: [rec],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})

			const result = await store.get(rec.id, documentId)
			expect(result?.id).toBe(rec.id)
		})

		it('commit updates records', async () => {
			const rec = makeRecord({ tagName: 'Bay' })
			await store.bulkWrite(documentId, { creates: [rec] })

			const updated = { ...rec, tagName: 'VoltageLevel' }
			await store.commit({
				documentId,
				creates: [],
				updates: [updated],
				deletes: [],
				onProgress: () => {},
			})

			const result = await store.get(rec.id, documentId)
			expect(result?.tagName).toBe('VoltageLevel')
		})

		it('commit deletes records', async () => {
			const rec = makeRecord()
			await store.bulkWrite(documentId, { creates: [rec] })

			await store.commit({
				documentId,
				creates: [],
				updates: [],
				deletes: [rec.id],
				onProgress: () => {},
			})

			const result = await store.get(rec.id, documentId)
			expect(result).toBeUndefined()
		})

		it('undo reverts last commit', async () => {
			const rec = makeRecord()
			await store.commit({
				documentId,
				creates: [rec],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})

			await store.undo(documentId)

			const result = await store.get(rec.id, documentId)
			expect(result).toBeUndefined()
		})

		it('redo re-applies undone commit', async () => {
			const rec = makeRecord()
			await store.commit({
				documentId,
				creates: [rec],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})

			await store.undo(documentId)
			await store.redo(documentId)

			const result = await store.get(rec.id, documentId)
			expect(result?.id).toBe(rec.id)
		})

		it('undo is no-op at beginning of history', async () => {
			// Should not throw
			await store.undo(documentId)
		})

		it('redo is no-op at end of history', async () => {
			// Should not throw
			await store.redo(documentId)
		})

		it('getChangeLog returns entries for file', async () => {
			const r1 = makeRecord()
			const r2 = makeRecord()
			await store.commit({
				documentId,
				creates: [r1],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})
			await store.commit({
				documentId,
				creates: [r2],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})

			const log = await store.getChangeLog(documentId)
			expect(log).toHaveLength(2)
			expect(log[0].sequenceNumber).toBeLessThan(log[1].sequenceNumber)
			expect(log[0].documentId).toBe(documentId)
		})

		it('changelog is file-scoped (no cross-file leaks)', async () => {
			const file2 = makeFile({ name: 'other' })
			await store.registerDocument(file2)

			await store.commit({
				documentId,
				creates: [makeRecord()],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})
			await store.commit({
				documentId: file2.id,
				creates: [makeRecord()],
				updates: [],
				deletes: [],
				onProgress: () => {},
			})

			const log1 = await store.getChangeLog(documentId)
			const log2 = await store.getChangeLog(file2.id)
			expect(log1).toHaveLength(1)
			expect(log2).toHaveLength(1)
		})
	})

	describe('cold restart', () => {
		it('survives close + reopen from scratch', async () => {
			const file = makeFile()
			await store.registerDocument(file)
			const rec = makeRecord()
			await store.bulkWrite(file.id, { creates: [rec] })

			// Close and reopen same DB name
			const name = store.name
			store.close()

			const store2 = new DexieStore(name)
			await store2.open()

			const files = await store2.getDocuments()
			expect(files).toHaveLength(1)
			expect(files[0].id).toBe(file.id)

			const records = await store2.getByDocumentId(file.id)
			expect(records).toHaveLength(1)
			expect(records[0].id).toBe(rec.id)

			await store2.destroy()
		})
	})
})
