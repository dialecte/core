import { makeRecord } from '../contract/store-contract.fixtures'
import {
	DOCUMENTS_SCHEMA,
	META_SCHEMA,
	TABLE_DOCUMENTS,
	TABLE_META,
	recordTableName,
} from '../store.constants'
import { DexieStore, buildDexieSchema } from './dexie-store'
import {
	DOCUMENT_VERSION_KEY_PREFIX,
	TABLE_VERSIONS,
	VERSION_KEY_PREFIX,
} from './dexie-store.constants'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { newCallId } from '@/store/json-values'

import type { StoreVersion } from '../store.types'
import type { DocumentRecord } from '@/project'

// IndexedDB keeps each document's version in a table of its own: one row per document, one row naming the database's
// engine; a database kept by a store before that table has its old rows copied once; a record count is answered only
// at the version it was counted at.

/** A row of the versions table: its key, and what it keeps. */
type VersionRow = { key: string }

const opened: DexieStore[] = []

afterEach(async () => {
	for (const store of opened.splice(0)) await store.close()
	for (const name of names.splice(0)) await Dexie.delete(name)
})

const names: string[] = []

function nameOfCase(): string {
	const name = `dexie-versions-${crypto.randomUUID()}`
	names.push(name)
	return name
}

function documentOf(id: string): DocumentRecord {
	return { id, name: id, extension: '.xml', configKey: 'default', createdAt: 0, status: 'ready' }
}

async function openStore(name: string): Promise<DexieStore> {
	const store = new DexieStore(name)
	opened.push(store)
	await store.open()
	return store
}

function versionOf(params: { store: DexieStore; documentId: string }): Promise<StoreVersion> {
	const { store, documentId } = params
	expect(store.readVersion, 'the store reads a version').toBeTypeOf('function')
	return store.readVersion({ documentId })
}

/** The keys of the rows new or changed from `before` to `after`. */
function changedKeys(params: { before: VersionRow[]; after: VersionRow[] }): string[] {
	const { before, after } = params
	const kept = new Map(before.map((row) => [row.key, JSON.stringify(row)]))
	return after.filter((row) => kept.get(row.key) !== JSON.stringify(row)).map((row) => row.key)
}

/** Every row of the versions table, as the database holds it. */
async function versionRows(params: { store: DexieStore }): Promise<VersionRow[]> {
	const db = params.store.getDatabaseInstance()
	expect(db.tables.map((table) => table.name)).toContain(TABLE_VERSIONS)
	return db.table(TABLE_VERSIONS).toArray()
}

/** A database as a store before the versions table left it: document `old` ready, its version row in `_meta`. */
async function seedOldDatabase(params: { name: string; count: number }): Promise<void> {
	const { name, count } = params
	const old = new Dexie(name)
	old.version(1).stores({
		[TABLE_DOCUMENTS]: buildDexieSchema(DOCUMENTS_SCHEMA),
		[TABLE_META]: buildDexieSchema(META_SCHEMA),
		[recordTableName('old')]: 'id, tagName',
	})
	await old.open()
	await old.table(TABLE_DOCUMENTS).put(documentOf('old'))
	await old.table(TABLE_META).put({ key: `${VERSION_KEY_PREFIX}old`, value: count })
	await old.table(recordTableName('old')).put(makeRecord({ id: 'r1' }))
	old.close()
}

describe('DexieStore - the version table', () => {
	it('a write of one document → only that document’s version row changes', async () => {
		const store = await openStore(nameOfCase())
		await store.registerDocument(documentOf('a'))
		await store.registerDocument(documentOf('b'))
		await store.bulkWrite('b', { creates: [makeRecord({ id: 'r1' })] })
		const before = await versionRows({ store })
		await store.commit({
			documentId: 'a',
			writeId: newCallId(),
			creates: [makeRecord({ id: 'r1' })],
			updates: [],
			deletes: [],
			onProgress: function ignoreProgress() {},
		})
		const after = await versionRows({ store })
		expect(changedKeys({ before, after })).toEqual([`${DOCUMENT_VERSION_KEY_PREFIX}a`])
		await expect(versionOf({ store, documentId: 'b' })).resolves.toMatchObject({ count: 1 })
	})

	it('a database kept before the version table → its old version rows copied once', async () => {
		const name = nameOfCase()
		await seedOldDatabase({ name, count: 7 })
		const store = await openStore(name)
		const first = await versionOf({ store, documentId: 'old' })
		await store.bulkWrite('old', { creates: [makeRecord({ id: 'r2' })] })
		await store.close()
		const again = await openStore(name)
		const second = await versionOf({ store: again, documentId: 'old' })
		// copied again, the old row would take the count back to 7
		expect({ first: first.count, second: second.count, engine: second.engineId }).toEqual({
			first: 7,
			second: 8,
			engine: first.engineId,
		})
	})

	it('two connections opening a database together → one engine id', async () => {
		const name = nameOfCase()
		const first = new DexieStore(name)
		const second = new DexieStore(name)
		opened.push(first, second)
		await Promise.all([first.open(), second.open()])
		const [ofFirst, ofSecond] = await Promise.all([
			versionOf({ store: first, documentId: 'any' }),
			versionOf({ store: second, documentId: 'any' }),
		])
		expect(ofSecond.engineId).toBe(ofFirst.engineId)
	})

	it('a record count, then a write through another connection → the count after the write', async () => {
		const name = nameOfCase()
		const counting = await openStore(name)
		await counting.registerDocument(documentOf('a'))
		await counting.bulkWrite('a', { creates: [makeRecord({ id: 'r1' })] })
		const writer = await openStore(name)
		const before = await counting.count('a')
		await writer.bulkWrite('a', { creates: [makeRecord({ id: 'r2' })] })
		const after = await counting.count('a')
		expect({ before, after }).toEqual({ before: 1, after: 2 })
	})
})
