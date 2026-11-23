import { makeRecord } from '../contract/store-contract.fixtures'
import {
	BLOB_DATA_SCHEMA,
	BLOBS_SCHEMA,
	CHANGELOG_SCHEMA,
	DOCUMENTS_SCHEMA,
	META_SCHEMA,
	TABLE_BLOBS,
	TABLE_CHANGELOG,
	TABLE_DOCUMENTS,
	TABLE_META,
	blobTableName,
	recordTableName,
} from '../store.constants'
import { DexieStore, buildDexieSchema } from './dexie-store'
import { DEFAULT_RECORD_SCHEMA, VERSION_KEY_PREFIX } from './dexie-store.constants'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { newCallId } from '@/store/json-values'

import type { StoreVersion } from '../store.types'
import type { DocumentRecord } from '@/project'

// IndexedDB keeps each document's version in `_meta` (`writes:<id>`), beside one row naming the database's engine: a
// database core 0.14 wrote goes on from its counts under an engine drawn once; an open that finds the engine row
// writes nothing; a record count is answered only at the version it was counted at.

/** A row of `_meta`: its key, and what it keeps. */
type MetaRow = { key: string }

/** The schema version of the database the 0.14 case opens: past 1, as every database a registration grew. */
const OLD_SCHEMA_VERSION = 3

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

/** The keys of the version rows new or changed from `before` to `after`. */
function changedVersionKeys(params: { before: MetaRow[]; after: MetaRow[] }): string[] {
	const { before, after } = params
	const kept = new Map(before.map((row) => [row.key, JSON.stringify(row)]))
	return after
		.filter((row) => row.key.startsWith(VERSION_KEY_PREFIX))
		.filter((row) => kept.get(row.key) !== JSON.stringify(row))
		.map((row) => row.key)
}

/** Every row of `_meta`, as the database holds it. */
function metaRows(params: { store: DexieStore }): Promise<MetaRow[]> {
	return params.store.getDatabaseInstance().table(TABLE_META).toArray()
}

/**
 * A database as core 0.14 left it: its schema past version 1 (`OLD_SCHEMA_VERSION`), every system table, documents
 * `a` and `b` ready with their record and blob tables, their counts in `_meta` (`writes:a` 7, `writes:b` 3), no engine
 * row.
 */
async function seedOldDatabase(params: { name: string }): Promise<void> {
	const old = new Dexie(params.name)
	const tables: Record<string, string> = {
		[TABLE_DOCUMENTS]: buildDexieSchema(DOCUMENTS_SCHEMA),
		[TABLE_CHANGELOG]: buildDexieSchema(CHANGELOG_SCHEMA),
		[TABLE_META]: buildDexieSchema(META_SCHEMA),
		[TABLE_BLOBS]: buildDexieSchema(BLOBS_SCHEMA),
	}
	for (const id of ['a', 'b']) {
		tables[recordTableName(id)] = buildDexieSchema(DEFAULT_RECORD_SCHEMA)
		tables[blobTableName(id)] = buildDexieSchema(BLOB_DATA_SCHEMA)
	}
	old.version(OLD_SCHEMA_VERSION).stores(tables)
	await old.open()
	await old.table(TABLE_DOCUMENTS).bulkPut([documentOf('a'), documentOf('b')])
	await old.table(TABLE_META).bulkPut([
		{ key: 'schemaVersion', value: OLD_SCHEMA_VERSION },
		{ key: `${VERSION_KEY_PREFIX}a`, value: 7 },
		{ key: `${VERSION_KEY_PREFIX}b`, value: 3 },
	])
	await old.table(recordTableName('a')).put(makeRecord({ id: 'r1' }))
	await old.table(recordTableName('b')).put(makeRecord({ id: 'r1' }))
	old.close()
}

describe('DexieStore - the versions in _meta', () => {
	it('a write of one document → only that document’s version row changes', async () => {
		const store = await openStore(nameOfCase())
		await store.registerDocument(documentOf('a'))
		await store.registerDocument(documentOf('b'))
		await store.bulkWrite('b', { creates: [makeRecord({ id: 'r1' })] })
		const before = await metaRows({ store })
		await store.commit({
			documentId: 'a',
			writeId: newCallId(),
			creates: [makeRecord({ id: 'r1' })],
			updates: [],
			deletes: [],
			onProgress: function ignoreProgress() {},
		})
		const after = await metaRows({ store })
		expect(changedVersionKeys({ before, after })).toEqual([`${VERSION_KEY_PREFIX}a`])
		await expect(versionOf({ store, documentId: 'b' })).resolves.toMatchObject({ count: 1 })
	})

	it('a database core 0.14 wrote, opened by two stores at once → one engine id, the counts kept, then moved by one', async () => {
		const name = nameOfCase()
		await seedOldDatabase({ name })
		const first = new DexieStore(name)
		const second = new DexieStore(name)
		opened.push(first, second)
		await Promise.all([first.open(), second.open()])
		const [aOfFirst, aOfSecond, bOfSecond] = await Promise.all([
			versionOf({ store: first, documentId: 'a' }),
			versionOf({ store: second, documentId: 'a' }),
			versionOf({ store: second, documentId: 'b' }),
		])
		await first.bulkWrite('a', { creates: [makeRecord({ id: 'r2' })] })
		const aAfterWrite = await versionOf({ store: second, documentId: 'a' })
		expect({
			sameEngine: aOfSecond.engineId === aOfFirst.engineId,
			counts: [aOfFirst.count, aOfSecond.count, bOfSecond.count, aAfterWrite.count],
			engineKept: aAfterWrite.engineId === aOfFirst.engineId,
		}).toEqual({ sameEngine: true, counts: [7, 7, 3, 8], engineKept: true })
	})

	it('a database opened again → its engine row found, nothing of _meta written', async () => {
		const name = nameOfCase()
		const store = await openStore(name)
		await store.registerDocument(documentOf('a'))
		const before = await versionOf({ store, documentId: 'a' })
		const rowsBefore = await metaRows({ store })
		await store.close()
		const again = await openStore(name)
		const rowsAfter = await metaRows({ store: again })
		const after = await versionOf({ store: again, documentId: 'a' })
		expect({ rows: rowsAfter, version: after }).toEqual({ rows: rowsBefore, version: before })
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
