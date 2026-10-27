import {
	expectRejectsWith,
	makeBlobEntry,
	makeDocument,
	makeRecord,
} from '../../contract/store-contract.fixtures'
import { loadSqlite } from '../load-sqlite'
import { LAYOUT_VERSION } from './engine.constants'
import { ENGINE_TEST_DIALECTE_ID, openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'

import type { SqliteEngine, SqliteEngineOptions } from './engine.types'
import type { DialecteErrorKey } from '@/errors'
import type { AnyRawRecord, RecordPatch } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

function openFile(): ReturnType<typeof openMemoryFile> {
	return openMemoryFile({ opened })
}

function metaOf(params: { db: Database }): Record<string, string> {
	const rows = params.db.selectArrays('SELECT key, value FROM _meta ORDER BY key')
	return Object.fromEntries(rows.map(([key, value]) => [String(key), String(value)]))
}

describe('openSqliteEngine', () => {
	describe('a fresh file', () => {
		afterEach(() => {
			// the device memory a case reports, dropped: the browser's own reads again
			Reflect.deleteProperty(navigator, 'deviceMemory')
		})

		type TestCase = {
			/** what `navigator.deviceMemory` reports while the engine starts (`undefined`: not reported) */
			deviceMemoryGiB: number | undefined
			options?: Partial<SqliteEngineOptions>
			expectedCacheMiB: number
		}
		const testCases: Record<string, TestCase> = {
			'no options, a 2 GiB device → this library’s layout in the header and the meta table, the dialecte id kept, incremental auto-vacuum, a 128 MiB cache':
				{ deviceMemoryGiB: 2, expectedCacheMiB: 128 },
			'no options, the device memory not reported → the cache of a 4 GiB device: 256 MiB': {
				deviceMemoryGiB: undefined,
				expectedCacheMiB: 256,
			},
			'a steady cache of 100 MiB asked → 100 MiB, whatever the device': {
				deviceMemoryGiB: 2,
				options: { steadyCacheMiB: 100 },
				expectedCacheMiB: 100,
			},
			'a cache rule of its own → the steady cache follows it': {
				deviceMemoryGiB: 2,
				options: { cacheRule: { mibPerGiB: 1, floorMiB: 3, ceilingMiB: 3 } },
				expectedCacheMiB: 3,
			},
		}

		for (const [description, testCase] of Object.entries(testCases)) {
			it(description, async () => {
				Object.defineProperty(navigator, 'deviceMemory', {
					value: testCase.deviceMemoryGiB,
					configurable: true,
				})
				const file = await openFile()
				const db = file.connect()
				await startEngine({ db, options: testCase.options })
				expect(db.selectValue('PRAGMA user_version')).toBe(LAYOUT_VERSION)
				expect(db.selectValue('PRAGMA auto_vacuum')).toBe(2)
				expect(metaOf({ db })).toEqual({
					dialecteId: ENGINE_TEST_DIALECTE_ID,
					layoutVersion: String(LAYOUT_VERSION),
				})
				// a negative cache_size is a size in KiB
				expect(db.selectValue('PRAGMA cache_size')).toBe(-testCase.expectedCacheMiB * 1024)
			})
		}
	})

	describe('a file laid out by another version of the library', () => {
		type TestCase = {
			/** what the file holds before the engine starts on it */
			prepare: (db: Database) => void
			expectedLayoutVersion: number
		}
		const testCases: Record<string, TestCase> = {
			'a later layout in the header → refused PROJECT_LAYOUT_OUTDATED, the file unchanged, the connection closed':
				{
					prepare: (db) =>
						db.exec(`CREATE TABLE later (x); PRAGMA user_version=${LAYOUT_VERSION + 1}`),
					expectedLayoutVersion: LAYOUT_VERSION + 1,
				},
			'layout 1 (no history, no blobs) in the header → refused PROJECT_LAYOUT_OUTDATED, the file unchanged, the connection closed':
				{
					prepare: (db) =>
						db.exec(
							'CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); ' +
								"INSERT INTO _meta VALUES ('dialecteId', 'core/test'), ('layoutVersion', '1'); " +
								'CREATE TABLE _documents (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE); ' +
								'PRAGMA user_version=1',
						),
					expectedLayoutVersion: 1,
				},
			'layout 2 (no document path) in the header → refused PROJECT_LAYOUT_OUTDATED, the file unchanged, the connection closed':
				{
					prepare: (db) =>
						db.exec(
							'CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); ' +
								"INSERT INTO _meta VALUES ('dialecteId', 'core/test'), ('layoutVersion', '2'); " +
								'CREATE TABLE _documents (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, ' +
								'name TEXT NOT NULL, extension TEXT NOT NULL, configKey TEXT NOT NULL, ' +
								'createdAt INTEGER NOT NULL, metadata TEXT, status TEXT NOT NULL, writeId TEXT); ' +
								'PRAGMA user_version=2',
						),
					expectedLayoutVersion: 2,
				},
			'no layout in the header but tables → refused PROJECT_LAYOUT_OUTDATED, the file unchanged, the connection closed':
				{
					prepare: (db) => db.exec('CREATE TABLE other (x)'),
					expectedLayoutVersion: 0,
				},
		}

		for (const [description, testCase] of Object.entries(testCases)) {
			it(description, async () => {
				const sqlite3 = await loadSqlite()
				const file = await openFile()
				testCase.prepare(file.keeper)
				const before = sqlite3.capi.sqlite3_js_db_export(file.keeper)
				const db = file.connect()
				await expectRejectsWith({
					action: startEngine({ db }),
					key: 'PROJECT_LAYOUT_OUTDATED',
					meta: {
						layoutVersion: testCase.expectedLayoutVersion,
						expectedLayoutVersion: LAYOUT_VERSION,
					},
				})
				expect(sqlite3.capi.sqlite3_js_db_export(file.keeper)).toEqual(before)
				// the refused engine let go of its connection: deleting the project stays possible
				expect(db.isOpen()).toBe(false)
			})
		}

		it('a file at this layout → the engine starts on it, the file as it was', async () => {
			const sqlite3 = await loadSqlite()
			const file = await openFile()
			const first = await startEngine({ db: file.connect() })
			first.close()
			const before = sqlite3.capi.sqlite3_js_db_export(file.keeper)
			const second = await startEngine({ db: file.connect() })
			second.close()
			expect(sqlite3.capi.sqlite3_js_db_export(file.keeper)).toEqual(before)
		})

		it('a document at a path → the file itself refuses a second row at that path, any number without one', async () => {
			const file = await openFile()
			const db = file.connect()
			const engine = await startEngine({ db })
			await engine.registerDocument(
				makeDocument({ id: 'a', name: 'north', path: 'subs/north.xml' }),
			)
			await engine.registerDocument(makeDocument({ id: 'b' }))
			function insert(params: { id: string; path: string | null }): void {
				db.exec({
					sql:
						'INSERT INTO _documents (id, name, extension, configKey, createdAt, status, path) ' +
						"VALUES (?, 'north', '.xml', 'test', 0, 'ready', ?)",
					bind: [params.id, params.path],
				})
			}
			expect(() => insert({ id: 'c', path: 'subs/north.xml' })).toThrow(
				/UNIQUE constraint failed: _documents\.path/,
			)
			insert({ id: 'd', path: null })
			engine.close()
		})
	})

	describe('a bulk write of a value that is not JSON (a function), refused whole', () => {
		type TestCase = {
			ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[] }
			expectedKey: DialecteErrorKey
		}
		const notJson = (() => '') as unknown as string
		const testCases: Record<string, TestCase> = {
			'a create holding it → STORE_VALUE_NOT_JSON, nothing written': {
				ops: { creates: [{ ...makeRecord({ id: 'r9' }), value: notJson }] },
				expectedKey: 'STORE_VALUE_NOT_JSON',
			},
			'a patch holding it → STORE_VALUE_NOT_JSON, nothing written': {
				ops: { updates: [{ recordId: 'r1', value: notJson }] },
				expectedKey: 'STORE_VALUE_NOT_JSON',
			},
			'a taken id and a patch holding it → the taken id refused first: STORE_DUPLICATE_ID': {
				ops: {
					creates: [makeRecord({ id: 'r1' })],
					updates: [{ recordId: 'r1', value: notJson }],
				},
				expectedKey: 'STORE_DUPLICATE_ID',
			},
			'a create and a patch holding it → STORE_VALUE_NOT_JSON, the create rolled back': {
				ops: {
					creates: [makeRecord({ id: 'r9' })],
					updates: [{ recordId: 'r1', value: notJson }],
				},
				expectedKey: 'STORE_VALUE_NOT_JSON',
			},
			'a taken id and a create holding it → the creates checked first: STORE_VALUE_NOT_JSON': {
				ops: {
					creates: [makeRecord({ id: 'r1' }), { ...makeRecord({ id: 'r9' }), value: notJson }],
				},
				expectedKey: 'STORE_VALUE_NOT_JSON',
			},
		}

		for (const [description, testCase] of Object.entries(testCases)) {
			it(description, async () => {
				const file = await openFile()
				const engine = await startEngine({ db: file.connect() })
				await engine.registerDocument(makeDocument())
				await engine.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
				await expectRejectsWith({
					action: engine.bulkWrite('doc-1', testCase.ops),
					key: testCase.expectedKey,
				})
				expect(await engine.getByDocumentId('doc-1')).toEqual([makeRecord({ id: 'r1' })])
				// no transaction left open: the next write lands
				await engine.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r2' })] })
				expect(await engine.count('doc-1')).toBe(2)
			})
		}
	})

	it('a removed document → its pages given back to the file: no free page left, the file as small as before', async () => {
		const file = await openFile()
		const db = file.connect()
		const engine = await startEngine({ db })
		await engine.registerDocument(makeDocument({ id: 'kept' }))
		const pagesBefore = Number(db.selectValue('PRAGMA page_count'))
		await engine.registerDocument(makeDocument())
		const records = Array.from({ length: 2000 }, (_, index) =>
			makeRecord({ id: `r${index}`, value: 'x'.repeat(200) }),
		)
		await engine.bulkWrite('doc-1', { creates: records })
		await engine.removeDocument('doc-1')
		expect(db.selectValue('PRAGMA freelist_count')).toBe(0)
		expect(Number(db.selectValue('PRAGMA page_count'))).toBe(pagesBefore)
	})

	it('a file holding a document left importing → the engine start drops its table and its row; a ready one stays', async () => {
		const file = await openFile()
		const first = await startEngine({ db: file.connect() })
		await first.registerDocument(makeDocument({ id: 'kept' }))
		await first.registerDocument(
			makeDocument({ id: 'left', status: 'importing', writeId: 'w-left' }),
		)
		await first.bulkWrite('left', { creates: [makeRecord({ id: 'l1' })] })
		first.close()
		const db = file.connect()
		const second = await startEngine({ db })
		expect((await second.getDocuments()).map((document) => document.id)).toEqual(['kept'])
		expect(await second.getWriteOutcome({ writeId: 'w-left' })).toBe('not-applied')
		const recordTables = db.selectValue(
			"SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name LIKE 'xel_%'",
		)
		expect(recordTables).toBe(1)
		expect(db.selectValue('PRAGMA freelist_count')).toBe(0)
	})

	describe('a document going with everything it has', () => {
		/** What the file holds of the document `doc-1` and of the one kept: entries, history-rows tables, blobs, bytes. */
		function holdingsOf(params: { db: Database }): Record<string, unknown> {
			const { db } = params
			const count = (sql: string) => Number(db.selectValue(sql))
			return {
				entries: count("SELECT count(*) FROM _changeLog WHERE documentId = 'doc-1'"),
				keptEntries: count("SELECT count(*) FROM _changeLog WHERE documentId = 'kept'"),
				historyTables: count(
					"SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name LIKE 'xch_%'",
				),
				blobs: count("SELECT count(*) FROM _blobs WHERE documentId = 'doc-1'"),
				bytes: count('SELECT count(*) FROM _blobData'),
				freePages: count('PRAGMA freelist_count'),
			}
		}

		/** `doc-1` with a commit, an undone commit discarded by another, a blob of its own; `kept` with a commit and a blob. */
		async function seedHoldings(params: {
			engine: SqliteEngine
			status?: 'importing'
		}): Promise<void> {
			const { engine, status } = params
			const commitOf = (documentId: string, id: string) =>
				engine.commit({
					documentId,
					writeId: `w-${documentId}-${id}`,
					creates: [makeRecord({ id, value: 'x'.repeat(200) })],
					updates: [],
					deletes: [],
				})
			await engine.registerDocument(makeDocument({ id: 'kept' }))
			await commitOf('kept', 'k1')
			await engine.addBlob(makeBlobEntry({ id: 'b-kept', documentId: 'kept' }), new Blob(['k']))
			await engine.registerDocument(makeDocument())
			await commitOf('doc-1', 'r1')
			await commitOf('doc-1', 'r2')
			await engine.undo('doc-1')
			await commitOf('doc-1', 'r3')
			await engine.addBlob(makeBlobEntry({ id: 'b1' }), new Blob(['x'.repeat(5000)]))
			if (status) await engine.updateDocument('doc-1', { status })
		}

		const GONE = { entries: 0, keptEntries: 1, historyTables: 1, blobs: 0, bytes: 1, freePages: 0 }

		it('a removed document → no history entry of it (discarded ones included), no history-rows table, no blob of it, no free page; the other document’s kept', async () => {
			const file = await openFile()
			const db = file.connect()
			const engine = await startEngine({ db })
			await seedHoldings({ engine })
			await engine.removeDocument('doc-1')
			expect(holdingsOf({ db })).toEqual(GONE)
			expect(await engine.getWriteOutcome({ writeId: 'w-doc-1-r2' })).toBe('not-applied')
		})

		it('a file holding a document left importing with history and a blob → the engine start takes them all with it', async () => {
			const file = await openFile()
			const first = await startEngine({ db: file.connect() })
			await seedHoldings({ engine: first, status: 'importing' })
			first.close()
			const db = file.connect()
			await startEngine({ db })
			expect(holdingsOf({ db })).toEqual(GONE)
		})
	})

	describe('a failure of SQLite under an operation', () => {
		type TestCase = {
			/** what breaks before the operation: the file full, or the document's table gone behind the engine */
			breaks: 'file-full' | 'table-gone'
			act: (engine: SqliteEngine) => Promise<unknown>
			expectedKey: DialecteErrorKey
		}
		const manyRecords = Array.from({ length: 500 }, (_, index) =>
			makeRecord({ id: `n${index}`, value: 'x'.repeat(500) }),
		)
		const testCases: Record<string, TestCase> = {
			'registerDocument, the file full → STORE_COMMIT_FAILED': {
				breaks: 'file-full',
				act: (engine) => engine.registerDocument(makeDocument({ id: 'doc-2' })),
				expectedKey: 'STORE_COMMIT_FAILED',
			},
			'updateDocument, the file full → STORE_COMMIT_FAILED': {
				breaks: 'file-full',
				act: (engine) =>
					engine.updateDocument('doc-1', { metadata: { note: 'x'.repeat(100_000) } }),
				expectedKey: 'STORE_COMMIT_FAILED',
			},
			'bulkWrite creates, the file full → STORE_BULK_ADD_FAILED': {
				breaks: 'file-full',
				act: (engine) => engine.bulkWrite('doc-1', { creates: manyRecords }),
				expectedKey: 'STORE_BULK_ADD_FAILED',
			},
			'bulkWrite patches, the file full → STORE_BULK_UPDATE_FAILED': {
				breaks: 'file-full',
				act: (engine) =>
					engine.bulkWrite('doc-1', { updates: [{ recordId: 'r1', value: 'x'.repeat(100_000) }] }),
				expectedKey: 'STORE_BULK_UPDATE_FAILED',
			},
			'bulkWrite deletes, the table gone → STORE_DELETE_FAILED': {
				breaks: 'table-gone',
				act: (engine) => engine.bulkWrite('doc-1', { deletes: ['r1'] }),
				expectedKey: 'STORE_DELETE_FAILED',
			},
			'removeDocument, the table gone → STORE_DELETE_FAILED': {
				breaks: 'table-gone',
				act: (engine) => engine.removeDocument('doc-1'),
				expectedKey: 'STORE_DELETE_FAILED',
			},
			'get, the table gone → STORE_READ_FAILED': {
				breaks: 'table-gone',
				act: (engine) => engine.get('r1', 'doc-1'),
				expectedKey: 'STORE_READ_FAILED',
			},
			'getByDocumentId, the table gone → STORE_READ_FAILED': {
				breaks: 'table-gone',
				act: (engine) => engine.getByDocumentId('doc-1'),
				expectedKey: 'STORE_READ_FAILED',
			},
			'count, the table gone → STORE_READ_FAILED': {
				breaks: 'table-gone',
				act: (engine) => engine.count('doc-1'),
				expectedKey: 'STORE_READ_FAILED',
			},
			'getByTagNameInDocument, the table gone → STORE_READ_FAILED': {
				breaks: 'table-gone',
				act: (engine) => engine.getByTagNameInDocument('A', 'doc-1'),
				expectedKey: 'STORE_READ_FAILED',
			},
			'getMany, the table gone → STORE_READ_FAILED': {
				breaks: 'table-gone',
				act: (engine) => engine.getMany(['r1'], 'doc-1'),
				expectedKey: 'STORE_READ_FAILED',
			},
		}

		for (const [description, testCase] of Object.entries(testCases)) {
			it(`${description}, the failure as its cause`, async () => {
				const file = await openFile()
				const first = await startEngine({ db: file.connect() })
				await first.registerDocument(makeDocument())
				await first.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
				first.close()
				// a new engine: it has read nothing of the document yet (no count kept)
				const db = file.connect()
				const engine = await startEngine({ db })
				if (testCase.breaks === 'file-full') {
					db.exec(`PRAGMA max_page_count=${Number(db.selectValue('PRAGMA page_count'))}`)
				} else {
					db.exec('DROP TABLE xel_1')
				}
				const thrown = await testCase.act(engine).then(
					() => undefined,
					(error: unknown) => error,
				)
				const error = toDialecteError(thrown)
				expect(error?.key).toBe(testCase.expectedKey)
				expect(error?.cause).toBeInstanceOf(Error)
			})
		}

		it('a start on a connection that cannot be read → STORE_CONNECTION_FAILED', async () => {
			const file = await openFile()
			const db = file.connect()
			db.close()
			await expectRejectsWith({ action: startEngine({ db }), key: 'STORE_CONNECTION_FAILED' })
		})

		it('registerDocument of metadata that is not JSON (a function) → STORE_VALUE_NOT_JSON, nothing registered', async () => {
			const file = await openFile()
			const engine = await startEngine({ db: file.connect() })
			await expectRejectsWith({
				action: engine.registerDocument(makeDocument({ metadata: { hook: () => undefined } })),
				key: 'STORE_VALUE_NOT_JSON',
			})
			expect(await engine.getDocuments()).toEqual([])
		})
	})
})
