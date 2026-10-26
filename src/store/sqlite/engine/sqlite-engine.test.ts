import { expectRejectsWith, makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { loadSqlite } from '../load-sqlite'
import { openSqliteEngine } from './sqlite-engine'

import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'

import type { SqliteEngine, SqliteEngineOptions } from './engine.types'
import type { DialecteErrorKey } from '@/errors'
import type { AnyRawRecord, RecordPatch } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

const DIALECTE_ID = 'core/test'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

/** An in-memory file of its own, empty: a keeper connection holds it, `connect` opens another one. */
async function openFile(): Promise<{ keeper: Database; connect: () => Database }> {
	const sqlite3 = await loadSqlite()
	const name = `file:/engine-${crypto.randomUUID()}?vfs=memdb`
	const keeper = new sqlite3.oo1.DB(name, 'c')
	opened.push(keeper)
	return {
		keeper,
		connect: function connect() {
			const db = new sqlite3.oo1.DB(name, 'c')
			opened.push(db)
			return db
		},
	}
}

async function startEngine(params: { db: Database; options?: Partial<SqliteEngineOptions> }) {
	const { db, options } = params
	const sqlite3 = await loadSqlite()
	return openSqliteEngine({ sqlite3, db, dialecteId: DIALECTE_ID, options })
}

function metaOf(params: { db: Database }): Record<string, string> {
	const rows = params.db.selectArrays('SELECT key, value FROM _meta ORDER BY key')
	return Object.fromEntries(rows.map(([key, value]) => [String(key), String(value)]))
}

describe('openSqliteEngine', () => {
	describe('a fresh file', () => {
		type TestCase = {
			options?: Partial<SqliteEngineOptions>
			expected: {
				userVersion: number
				autoVacuum: number
				meta: Record<string, string>
				cacheSizeKiB: number
			}
		}
		const testCases: Record<string, TestCase> = {
			'no options → layout 1 in the header and the meta table, the dialecte id kept, incremental auto-vacuum, a 64 MiB cache':
				{
					expected: {
						userVersion: 1,
						autoVacuum: 2,
						meta: { dialecteId: DIALECTE_ID, layoutVersion: '1' },
						cacheSizeKiB: 64 * 1024,
					},
				},
			'a steady cache of 256 MiB asked → a 256 MiB cache, the rest as without options': {
				options: { steadyCacheMiB: 256 },
				expected: {
					userVersion: 1,
					autoVacuum: 2,
					meta: { dialecteId: DIALECTE_ID, layoutVersion: '1' },
					cacheSizeKiB: 256 * 1024,
				},
			},
		}

		for (const [description, testCase] of Object.entries(testCases)) {
			it(description, async () => {
				const file = await openFile()
				const db = file.connect()
				await startEngine({ db, options: testCase.options })
				expect(db.selectValue('PRAGMA user_version')).toBe(testCase.expected.userVersion)
				expect(db.selectValue('PRAGMA auto_vacuum')).toBe(testCase.expected.autoVacuum)
				expect(metaOf({ db })).toEqual(testCase.expected.meta)
				// a negative cache_size is a size in KiB
				expect(db.selectValue('PRAGMA cache_size')).toBe(-testCase.expected.cacheSizeKiB)
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
			'layout 2 in the header → refused PROJECT_LAYOUT_OUTDATED, the file unchanged, the connection closed':
				{
					prepare: (db) => db.exec('CREATE TABLE later (x); PRAGMA user_version=2'),
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
					meta: { layoutVersion: testCase.expectedLayoutVersion, expectedLayoutVersion: 1 },
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
	})

	describe('a bulk write of a value the file cannot keep (a function), refused whole', () => {
		type TestCase = {
			ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[] }
			expectedKey: DialecteErrorKey
		}
		const uncopyable = (() => '') as unknown as string
		const testCases: Record<string, TestCase> = {
			'a create holding it → STORE_BULK_ADD_FAILED, nothing written': {
				ops: { creates: [{ ...makeRecord({ id: 'r9' }), value: uncopyable }] },
				expectedKey: 'STORE_BULK_ADD_FAILED',
			},
			'a patch holding it → STORE_BULK_UPDATE_FAILED, nothing written': {
				ops: { updates: [{ recordId: 'r1', value: uncopyable }] },
				expectedKey: 'STORE_BULK_UPDATE_FAILED',
			},
			'a taken id and a patch holding it → the taken id refused first: STORE_DUPLICATE_ID': {
				ops: {
					creates: [makeRecord({ id: 'r1' })],
					updates: [{ recordId: 'r1', value: uncopyable }],
				},
				expectedKey: 'STORE_DUPLICATE_ID',
			},
			'a create and a patch holding it → STORE_BULK_UPDATE_FAILED, the create rolled back': {
				ops: {
					creates: [makeRecord({ id: 'r9' })],
					updates: [{ recordId: 'r1', value: uncopyable }],
				},
				expectedKey: 'STORE_BULK_UPDATE_FAILED',
			},
			'a taken id and a create holding it → the creates encoded first: STORE_BULK_ADD_FAILED': {
				ops: {
					creates: [makeRecord({ id: 'r1' }), { ...makeRecord({ id: 'r9' }), value: uncopyable }],
				},
				expectedKey: 'STORE_BULK_ADD_FAILED',
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

		it('registerDocument of metadata the file cannot keep (a function) → STORE_COMMIT_FAILED, nothing registered', async () => {
			const file = await openFile()
			const engine = await startEngine({ db: file.connect() })
			await expectRejectsWith({
				action: engine.registerDocument(makeDocument({ metadata: { hook: () => undefined } })),
				key: 'STORE_COMMIT_FAILED',
			})
			expect(await engine.getDocuments()).toEqual([])
		})
	})
})
