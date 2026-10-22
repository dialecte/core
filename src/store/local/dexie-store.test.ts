import { makeRecord as makeContractRecord } from '../contract/store-contract.fixtures'
import { DexieStore, buildDexieSchema } from './dexie-store'

import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import type { RecordSchema } from '../store.types'
import type { DocumentRecord } from '@/project'
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
		status: 'ready',
		...overrides,
	}
}

function makeRecord(): AnyRawRecord {
	return makeContractRecord({ id: crypto.randomUUID() })
}

// What any store must do is in src/store/contract; here is what is DexieStore's own.

describe('DexieStore', () => {
	let store: DexieStore

	beforeEach(async () => {
		store = new DexieStore(uniqueName())
		await store.open()
	})

	afterEach(async () => {
		await store.destroy()
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

describe('DexieStore cross-instance reconciliation', () => {
	const cleanups: Array<() => Promise<void>> = []

	afterEach(async () => {
		for (const fn of cleanups) {
			try {
				await fn()
			} catch {
				// best-effort cleanup
			}
		}
		cleanups.length = 0
	})

	// Two connections to the same database name, both open concurrently, model
	// the iframe/shell cross-realm setup: realm B is already open when realm A
	// imports a new document (schema bump adds the xel_<id> table).
	async function openPair(): Promise<{ a: DexieStore; b: DexieStore; name: string }> {
		const name = uniqueName()
		const a = new DexieStore(name)
		const b = new DexieStore(name)
		await a.open()
		await b.open()
		cleanups.push(async () => a.close())
		cleanups.push(async () => b.destroy())
		return { a, b, name }
	}

	it('self-heals reads when another open connection imports a document', async () => {
		const { a, b } = await openPair()

		const file = makeFile()
		const rec = makeRecord()
		await a.registerDocument(file)
		await a.bulkWrite(file.id, { creates: [rec] })

		// Without the self-heal, b's Dexie connection still lacks xel_<id> and reads the
		// document as absent (no records) here.
		const records = await b.getByDocumentId(file.id)
		expect(records).toHaveLength(1)
		expect(records[0].id).toBe(rec.id)
	})

	it('reconcile() adopts the schema of a foreign import', async () => {
		const { a, b } = await openPair()

		const file = makeFile()
		await a.registerDocument(file)

		expect(await b.isDocumentReadable(file.id)).toBe(false)

		await b.reconcile()

		expect(await b.isDocumentReadable(file.id)).toBe(true)
		const docs = await b.getDocuments()
		expect(docs.map((d) => d.id)).toContain(file.id)
	})

	it('isDocumentReadable is false for an unknown document', async () => {
		const { b } = await openPair()
		expect(await b.isDocumentReadable(crypto.randomUUID())).toBe(false)
	})
})
