import {
	contractFile,
	expectRejectsWith,
	makeBlobEntry,
	makeDocument,
	makeRecord,
} from '../../contract/store-contract.fixtures'
import { createContractRuntime } from '../../contract/store-contract.import-session'
import { loadSqlite } from '../load-sqlite'
import { ENGINE_WRITE_MEMBERS, IMPORT_SPACE_FLOOR_BYTES } from './engine.constants'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { SqliteEngine } from './engine.types'
import type { Database, Sqlite3Result } from '@sqlite.org/sqlite-wasm'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []
/** What a case changed of SQLite itself, put back after it. */
const restores: (() => void)[] = []

afterEach(() => {
	for (const restore of restores.splice(0)) restore()
	for (const db of opened.splice(0)) db.close()
})

/** Pages the file may still grow by once a case caps it: room for a few records, not for many. */
const PAGES_LEFT = 16

/** An engine on a file of its own, the file then emptied of free pages and capped `PAGES_LEFT` pages above its size. */
async function startCappedEngine(): Promise<{ engine: SqliteEngine; cap: () => void }> {
	const file = await openMemoryFile({ opened })
	const db = file.connect()
	const engine = await startEngine({ db, runtime: createContractRuntime() })
	return {
		engine,
		cap: function capFile() {
			// no free page left inside the file: a write that needs room must grow it (each step frees one page)
			const vacuum = db.prepare('PRAGMA incremental_vacuum')
			while (vacuum.step());
			vacuum.finalize()
			const pages = Number(db.selectValue('PRAGMA page_count'))
			db.exec(`PRAGMA max_page_count = ${pages + PAGES_LEFT}`)
		},
	}
}

function manyElements(params: { count: number }): string {
	return Array.from({ length: params.count }, (_, index) => `<A aA="${index}"/>`).join('')
}

describe('an import whose space is being checked', () => {
	it('its outcome asked meanwhile → running (no row yet, yet it will apply), then applied', async () => {
		const file = await openMemoryFile({ opened })
		const checking = Promise.withResolvers<void>()
		const engine = await startEngine({
			db: file.connect(),
			runtime: createContractRuntime(),
			ensureImportSpace: () => checking.promise,
		})
		const importing = engine.importFile({
			file: contractFile({ body: '<A aA="1"/>' }),
			writeId: 'w-1',
			clientId: 'c-1',
		})
		// the import has its turn and awaits its check
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(await engine.getWriteOutcome({ writeId: 'w-1' })).toBe('running')
		checking.resolve()
		await importing
		expect(await engine.getWriteOutcome({ writeId: 'w-1' })).toBe('applied')
	})
})

describe('an engine whose file can grow no more', () => {
	it('an import outgrowing it → STORE_QUOTA_EXCEEDED naming the project, nothing registered', async () => {
		const { engine, cap } = await startCappedEngine()
		cap()
		await expectRejectsWith({
			action: engine.importFile({
				file: contractFile({ body: manyElements({ count: 5_000 }) }),
				writeId: 'w-1',
				clientId: 'c-1',
			}),
			key: 'STORE_QUOTA_EXCEEDED',
			meta: { project: 'engine-test' },
		})
		expect(await engine.getDocuments()).toEqual([])
	})

	it('a commit outgrowing it → STORE_QUOTA_EXCEEDED naming the project, nothing of it applied', async () => {
		const { engine, cap } = await startCappedEngine()
		await engine.registerDocument(makeDocument())
		cap()
		await expectRejectsWith({
			action: engine.commit({
				documentId: 'doc-1',
				writeId: 'w-1',
				creates: Array.from({ length: 5_000 }, (_, index) => makeRecord({ id: `r${index}` })),
				updates: [],
				deletes: [],
			}),
			key: 'STORE_QUOTA_EXCEEDED',
			meta: { project: 'engine-test' },
		})
		expect(await engine.count('doc-1')).toBe(0)
	})
})

describe('a history step on a file that can grow no more', () => {
	/** 3,000 records created with `from` values, then one commit setting them all to `to`: the step's commit. */
	async function rewriteAll(params: {
		engine: SqliteEngine
		from: string
		to: string
	}): Promise<void> {
		const { engine, from, to } = params
		const ids = Array.from({ length: 3_000 }, (_, index) => `r${index}`)
		await engine.registerDocument(makeDocument())
		await engine.commit({
			documentId: 'doc-1',
			writeId: 'w-create',
			creates: ids.map((id) => makeRecord({ id, value: from })),
			updates: [],
			deletes: [],
		})
		await engine.commit({
			documentId: 'doc-1',
			writeId: 'w-rewrite',
			creates: [],
			updates: ids.map((id) => makeRecord({ id, value: to })),
			deletes: [],
		})
	}

	const big = 'x'.repeat(200)
	type TestCase = { step: 'undo' | 'redo'; from: string; to: string }
	const testCases: Record<string, TestCase> = {
		'an undo bringing larger values back → STORE_QUOTA_EXCEEDED naming the project, the history as it was':
			{
				step: 'undo',
				from: big,
				to: 'v',
			},
		'a redo bringing larger values back → STORE_QUOTA_EXCEEDED naming the project, the history as it was':
			{
				step: 'redo',
				from: 'v',
				to: big,
			},
	}
	for (const [description, { step, from, to }] of Object.entries(testCases)) {
		it(description, async () => {
			const { engine, cap } = await startCappedEngine()
			await rewriteAll({ engine, from, to })
			if (step === 'redo') await engine.undo('doc-1')
			const before = await engine.getHistoryStatus('doc-1')
			cap()
			await expectRejectsWith({
				action: step === 'undo' ? engine.undo('doc-1') : engine.redo('doc-1'),
				key: 'STORE_QUOTA_EXCEEDED',
				meta: { project: 'engine-test' },
			})
			expect(await engine.getHistoryStatus('doc-1')).toEqual(before)
			expect((await engine.get('r0', 'doc-1'))?.value).toBe(step === 'undo' ? to : from)
		})
	}
})

/**
 * Every statement that writes (SQLite's `sqlite3_stmt_readonly` false), or every `SELECT`, refused with
 * `resultCode` from now on, as a file system refusing a write; the step as it was once the case ends.
 */
async function refuseStatements(params: {
	statements: 'writes' | 'selects'
	resultCode: Sqlite3Result
}): Promise<void> {
	const { statements, resultCode } = params
	const sqlite3 = await loadSqlite()
	const step = sqlite3.capi.sqlite3_step
	sqlite3.capi.sqlite3_step = function stepOrRefuse(statement) {
		const refused =
			statements === 'writes'
				? sqlite3.capi.sqlite3_stmt_readonly(statement) === 0
				: /^\s*SELECT/i.test(sqlite3.capi.sqlite3_sql(statement) ?? '')
		return refused ? resultCode : step(statement)
	}
	restores.push(function restoreStep() {
		sqlite3.capi.sqlite3_step = step
	})
}

describe('every write of the engine, refused for want of space', () => {
	/** A document with two commits, the last undone, a blob attached and one not: each write below has work. */
	async function seedEveryWrite(params: { engine: SqliteEngine }): Promise<void> {
		const { engine } = params
		await engine.registerDocument(makeDocument())
		for (const writeId of ['w-1', 'w-2']) {
			await engine.commit({
				documentId: 'doc-1',
				writeId,
				creates: [makeRecord({ id: `r-${writeId}` })],
				updates: [],
				deletes: [],
			})
		}
		await engine.undo('doc-1')
		await engine.addBlob(makeBlobEntry({ id: 'b-attached' }), new Blob(['a']))
		await engine.attachBlob('b-attached', { documentId: 'doc-1', recordRef: 'r-w-1' })
		await engine.addBlob(makeBlobEntry({ id: 'b-loose' }), new Blob(['b']))
	}

	const testCases = {
		registerDocument: (engine) => engine.registerDocument(makeDocument({ id: 'doc-2' })),
		updateDocument: (engine) => engine.updateDocument('doc-1', { name: 'renamed' }),
		removeDocument: (engine) => engine.removeDocument('doc-1'),
		bulkWrite: (engine) => engine.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r-bulk' })] }),
		commit: (engine) =>
			engine.commit({
				documentId: 'doc-1',
				writeId: 'w-3',
				creates: [makeRecord({ id: 'r-w-3' })],
				updates: [],
				deletes: [],
			}),
		undo: (engine) => engine.undo('doc-1'),
		redo: (engine) => engine.redo('doc-1'),
		addBlob: (engine) => engine.addBlob(makeBlobEntry({ id: 'b-new' }), new Blob(['c'])),
		attachBlob: (engine) =>
			engine.attachBlob('b-loose', { documentId: 'doc-1', recordRef: 'r-w-1' }),
		detachBlob: (engine) =>
			engine.detachBlob('b-attached', { documentId: 'doc-1', recordRef: 'r-w-1' }),
		removeBlob: (engine) => engine.removeBlob('b-loose'),
	} satisfies Record<
		(typeof ENGINE_WRITE_MEMBERS)[number],
		(engine: SqliteEngine) => Promise<unknown>
	>

	for (const [member, act] of Object.entries(testCases)) {
		it(`${member}, its write refused SQLITE_FULL → STORE_QUOTA_EXCEEDED naming the project`, async () => {
			const engine = await startEngine({ db: (await openMemoryFile({ opened })).connect() })
			await seedEveryWrite({ engine })
			const sqlite3 = await loadSqlite()
			await refuseStatements({ statements: 'writes', resultCode: sqlite3.capi.SQLITE_FULL })
			await expectRejectsWith({
				action: act(engine),
				key: 'STORE_QUOTA_EXCEEDED',
				meta: { project: 'engine-test' },
			})
		})
	}

	it('a bulk write whose read fails with an I/O error on a nearly full origin → STORE_READ_FAILED, not a shortage', async () => {
		const sqlite3 = await loadSqlite()
		const engine = await startEngine({
			db: (await openMemoryFile({ opened })).connect(),
			explainIoFailure: function explainAsShortage() {
				return Promise.resolve(new Error('the origin is nearly full'))
			},
		})
		await engine.registerDocument(makeDocument())
		await refuseStatements({ statements: 'selects', resultCode: sqlite3.capi.SQLITE_IOERR })
		await expectRejectsWith({
			action: engine.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r-read' })] }),
			key: 'STORE_READ_FAILED',
		})
	})
})

describe('the space an import asks for', () => {
	/** An engine whose space check records what it is asked, and the bytes its file has free. */
	async function startAskedEngine(): Promise<{
		engine: SqliteEngine
		asked: number[]
		freeBytes: () => number
	}> {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		const asked: number[] = []
		const engine = await startEngine({
			db,
			runtime: createContractRuntime(),
			ensureImportSpace: async function recordAsked({ bytes }) {
				asked.push(bytes)
			},
		})
		return {
			engine,
			asked,
			freeBytes: function freeBytesOf() {
				return (
					Number(db.selectValue('PRAGMA freelist_count')) *
					Number(db.selectValue('PRAGMA page_size'))
				)
			},
		}
	}

	/** Free pages in the file: a commit deleting `count` records leaves their pages free. */
	async function freePagesOf(params: { engine: SqliteEngine; count: number }): Promise<void> {
		const { engine, count } = params
		const ids = Array.from({ length: count }, (_, index) => `r${index}`)
		await engine.registerDocument(makeDocument())
		await engine.commit({
			documentId: 'doc-1',
			writeId: 'w-fill',
			creates: ids.map((id) => makeRecord({ id, value: 'x'.repeat(200) })),
			updates: [],
			deletes: [],
		})
		await engine.commit({
			documentId: 'doc-1',
			writeId: 'w-empty',
			creates: [],
			updates: [],
			deletes: ids,
		})
	}

	/** What the measurements set (a project file up to 7.5 times its XML), stated here, not read from the engine. */
	const MEASURED_FACTOR = 8

	type TestCase = {
		elements: number
		freedRecords: number
		expected: (params: { size: number; free: number }) => number
	}
	const testCases: Record<string, TestCase> = {
		'a file of about 300 KB, no page free → eight times its size': {
			elements: 15_000,
			freedRecords: 0,
			expected: ({ size }) => MEASURED_FACTOR * size,
		},
		'a file of a few bytes → the floor a new document needs, not eight times its size': {
			elements: 1,
			freedRecords: 0,
			expected: () => IMPORT_SPACE_FLOOR_BYTES,
		},
		'free pages covering part of it → eight times its size less the free bytes': {
			elements: 15_000,
			freedRecords: 2_000,
			expected: ({ size, free }) => MEASURED_FACTOR * size - free,
		},
		'free pages covering all of it → nothing asked': {
			elements: 300,
			freedRecords: 20_000,
			expected: () => 0,
		},
	}
	for (const [description, { elements, freedRecords, expected }] of Object.entries(testCases)) {
		it(description, async () => {
			const { engine, asked, freeBytes } = await startAskedEngine()
			if (freedRecords > 0) await freePagesOf({ engine, count: freedRecords })
			const file = contractFile({ body: manyElements({ count: elements }) })
			const free = freeBytes()
			if (freedRecords > 0) expect(free).toBeGreaterThan(0)
			await engine.importFile({ file, writeId: 'w-asked', clientId: 'c-1' })
			expect(asked).toEqual([Math.max(0, expected({ size: file.size, free }))])
		})
	}
})
