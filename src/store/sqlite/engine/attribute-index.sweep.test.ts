import { makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { attributeIndexTablesOf } from './attribute-index'
import { ATTRIBUTE_INDEX_TRIGGERS } from './attribute-index.constants'
import {
	indexRowsOf,
	indexTablesHeldOf,
	pairStatesOf,
	recomputedIndexRowsOf,
	seqOf,
	untilPairsReady,
} from './attribute-index.fixtures'
import { TABLE_HISTORY_ROWS_PREFIX } from './engine.constants'
import { openMemoryFile, startEngine, untilNoFreePages } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { TABLE_DOCUMENTS, TABLE_RECORD_PREFIX } from '@/store/store.constants'

import type { SqliteEngine } from './engine.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

const DOCUMENT_ID = 'doc-1'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

/** `x`, `c` of A hold k="1", `m` of A k="2". */
const SEEDED = [
	makeRecord({ id: 'x', tagName: 'A', attributes: [{ name: 'k', value: '1' }] }),
	makeRecord({ id: 'm', tagName: 'A', attributes: [{ name: 'k', value: '2' }] }),
	makeRecord({ id: 'c', tagName: 'A', attributes: [{ name: 'k', value: '1' }] }),
]

/**
 * A file whose document holds `SEEDED` with the pair A.k built, its engine closed: `plain` is a connection that
 * registers nothing, `restart` starts the next engine on the file (its connection beside it).
 */
async function builtThenClosed(): Promise<{
	plain: Database
	seq: number
	restart: () => Promise<{ engine: SqliteEngine; db: Database }>
}> {
	const file = await openMemoryFile({ opened })
	const first = file.connect()
	const engine = await startEngine({ db: first })
	await engine.registerDocument(makeDocument())
	await engine.bulkWrite(DOCUMENT_ID, { creates: SEEDED })
	const seq = seqOf({ db: first, documentId: DOCUMENT_ID })
	await engine.getByAttributes({
		documentId: DOCUMENT_ID,
		tagName: 'A',
		attributes: [{ name: 'k', values: ['1'] }],
	})
	await untilPairsReady({ db: first, seq, pairs: 1 })
	engine.close()
	return {
		plain: file.connect(),
		seq,
		restart: async function restart() {
			const db = file.connect()
			return { engine: await startEngine({ db }), db }
		},
	}
}

/** The index triggers the record table numbered `seq` holds, by their event. */
function indexTriggersOf(params: { db: Database; seq: number }): string[] {
	const { db, seq } = params
	const { triggers } = attributeIndexTablesOf({ seq })
	// a prefix, not a LIKE pattern: `_` would also match the triggers of `xatr_11_`
	return db
		.selectValues("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name")
		.map(String)
		.filter((name) => name.startsWith(triggers))
		.map((name) => name.slice(triggers.length))
}

/** The ids of A holding k="1" the engine answers. */
async function holdersOf(engine: SqliteEngine): Promise<string[]> {
	const records = await engine.getByAttributes({
		documentId: DOCUMENT_ID,
		tagName: 'A',
		attributes: [{ name: 'k', values: ['1'] }],
	})
	return records.map((record) => record.id)
}

describe('the attribute indexes swept when an engine starts', () => {
	it('index tables an older removal left without their record table → dropped at the next start, nothing else of the file touched', async () => {
		const { plain, seq, restart } = await builtThenClosed()
		async function leftThenSwept(): Promise<Record<string, unknown>> {
			// an older core's removal: the record and history tables and the row go, the index tables stay
			plain.exec(
				`DROP TABLE ${TABLE_RECORD_PREFIX}${seq}; DROP TABLE ${TABLE_HISTORY_ROWS_PREFIX}${seq}; ` +
					`DELETE FROM ${TABLE_DOCUMENTS} WHERE seq = ${seq}`,
			)
			const left = indexTablesHeldOf({ db: plain, seq })
			const { engine, db } = await restart()
			return {
				left,
				swept: indexTablesHeldOf({ db, seq }),
				documents: (await engine.getDocuments()).length,
			}
		}
		const { names, rows, keys } = attributeIndexTablesOf({ seq })
		await expect(leftThenSwept()).resolves.toEqual({
			left: [names, rows, keys],
			swept: [],
			documents: 0,
		})
	})

	it('a record table keeping its index triggers whose index tables were dropped → the triggers dropped at the next start, every write lands, the pair built again', async () => {
		const { plain, seq, restart } = await builtThenClosed()
		async function tablesGone(): Promise<Record<string, unknown>> {
			const { names, rows, keys } = attributeIndexTablesOf({ seq })
			plain.exec(`DROP TABLE ${rows}; DROP TABLE ${keys}; DROP TABLE ${names}`)
			const { engine, db } = await restart()
			const triggersAtStart = indexTriggersOf({ db, seq })
			await engine.bulkWrite(DOCUMENT_ID, {
				creates: [makeRecord({ id: 'n', tagName: 'A', attributes: [{ name: 'k', value: '1' }] })],
				updates: [{ recordId: 'm', attributes: [{ name: 'k', value: '1' }] }],
				deletes: ['x'],
			})
			const first = await holdersOf(engine)
			await untilPairsReady({ db, seq, pairs: 1 })
			return {
				triggersAtStart,
				first,
				built: await holdersOf(engine),
				exact:
					JSON.stringify(indexRowsOf({ db, seq })) ===
					JSON.stringify(recomputedIndexRowsOf({ db, seq })),
			}
		}
		await expect(tablesGone()).resolves.toEqual({
			triggersAtStart: [],
			first: ['c', 'm', 'n'],
			built: ['c', 'm', 'n'],
			exact: true,
		})
	})

	it('a record table that lost two of its index triggers → its other triggers and its index tables dropped at the next start, the pair built again', async () => {
		const { plain, seq, restart } = await builtThenClosed()
		async function halfTriggered(): Promise<Record<string, unknown>> {
			const { triggers } = attributeIndexTablesOf({ seq })
			plain.exec(`DROP TRIGGER ${triggers}afterInsert; DROP TRIGGER ${triggers}afterDelete`)
			const { engine, db } = await restart()
			const atStart = {
				triggers: indexTriggersOf({ db, seq }),
				tables: indexTablesHeldOf({ db, seq }),
			}
			const first = await holdersOf(engine)
			await untilPairsReady({ db, seq, pairs: 1 })
			return { atStart, first, triggers: indexTriggersOf({ db, seq }) }
		}
		await expect(halfTriggered()).resolves.toEqual({
			atStart: { triggers: [], tables: [] },
			first: ['c', 'x'],
			triggers: [...ATTRIBUTE_INDEX_TRIGGERS].sort(),
		})
	})

	it('a whole index → kept at the next start, its pair still ready, its rows read', async () => {
		const { seq, restart } = await builtThenClosed()
		async function keptWhole(): Promise<Record<string, unknown>> {
			const { engine, db } = await restart()
			const states = pairStatesOf({ db, seq })
			// the index's rows taken away: a lookup that answers nothing read the index
			db.exec(`DELETE FROM ${attributeIndexTablesOf({ seq }).rows}`)
			return { states, fromIndex: await holdersOf(engine) }
		}
		await expect(keptWhole()).resolves.toEqual({ states: { 'A.k': 'ready' }, fromIndex: [] })
	})

	it('a broken index numbered 1 beside a whole one numbered 11 → only the broken one swept, the whole one still ready and read', async () => {
		const file = await openMemoryFile({ opened })
		const first = file.connect()
		const engine = await startEngine({ db: first })
		const ids = Array.from({ length: 11 }, (_, index) => `doc-${index + 1}`)
		for (const id of ids) {
			await engine.registerDocument(makeDocument({ id }))
			await engine.bulkWrite(id, { creates: SEEDED })
			await engine.getByAttributes({
				documentId: id,
				tagName: 'A',
				attributes: [{ name: 'k', values: ['1'] }],
			})
			await untilPairsReady({ db: first, seq: seqOf({ db: first, documentId: id }), pairs: 1 })
		}
		const broken = seqOf({ db: first, documentId: 'doc-1' })
		const whole = seqOf({ db: first, documentId: 'doc-11' })
		engine.close()
		async function sideBySide(): Promise<Record<string, unknown>> {
			const { names, rows, keys } = attributeIndexTablesOf({ seq: broken })
			file.connect().exec(`DROP TABLE ${rows}; DROP TABLE ${keys}; DROP TABLE ${names}`)
			const db = file.connect()
			const next = await startEngine({ db })
			const atStart = {
				broken: indexTriggersOf({ db, seq: broken }),
				whole: indexTriggersOf({ db, seq: whole }),
				states: pairStatesOf({ db, seq: whole }),
			}
			// the whole index's rows taken away: a lookup that answers nothing read the index
			db.exec(`DELETE FROM ${attributeIndexTablesOf({ seq: whole }).rows}`)
			const records = await next.getByAttributes({
				documentId: 'doc-11',
				tagName: 'A',
				attributes: [{ name: 'k', values: ['1'] }],
			})
			return { numbers: [broken, whole], atStart, fromIndex: records.length }
		}
		await expect(sideBySide()).resolves.toEqual({
			numbers: [1, 11],
			atStart: {
				broken: [],
				whole: [...ATTRIBUTE_INDEX_TRIGGERS].sort(),
				states: { 'A.k': 'ready' },
			},
			fromIndex: 0,
		})
	})

	it('a trigger a tool named like an index trigger, with a space in its name → left as it is, the engine starts and writes', async () => {
		const { plain, seq, restart } = await builtThenClosed()
		async function foreignTrigger(): Promise<Record<string, unknown>> {
			plain.exec(
				`CREATE TRIGGER "xatr_3_x y" AFTER INSERT ON ${TABLE_RECORD_PREFIX}${seq} BEGIN SELECT 1; END`,
			)
			const { engine, db } = await restart()
			await engine.bulkWrite(DOCUMENT_ID, {
				creates: [makeRecord({ id: 'n', tagName: 'A', attributes: [{ name: 'k', value: '1' }] })],
			})
			return {
				foreign: db.selectValue("SELECT count(*) FROM sqlite_schema WHERE name = 'xatr_3_x y'"),
				answer: await holdersOf(engine),
			}
		}
		await expect(foreignTrigger()).resolves.toEqual({ foreign: 1, answer: ['c', 'n', 'x'] })
	})
})

describe('the record rows the index points at', () => {
	it('a large removal, then the engine’s reclaim to no free page → the record rows kept their numbers: the index equals its recomputation, the lookups exact', async () => {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		const engine = await startEngine({ db, options: { reclaimSliceMs: 0 } })
		await engine.registerDocument(makeDocument({ id: 'bulky' }))
		await engine.bulkWrite('bulky', {
			creates: Array.from({ length: 3_000 }, (_, index) =>
				makeRecord({
					id: `b${index}`,
					tagName: 'A',
					attributes: [{ name: 'v', value: 'v'.repeat(200) }],
				}),
			),
		})
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite(DOCUMENT_ID, { creates: SEEDED })
		const seq = seqOf({ db, documentId: DOCUMENT_ID })
		async function reclaimed(): Promise<Record<string, unknown>> {
			await holdersOf(engine)
			await untilPairsReady({ db, seq, pairs: 1 })
			await engine.bulkWrite(DOCUMENT_ID, { deletes: ['x'] })
			await engine.removeDocument('bulky')
			await untilNoFreePages({ db })
			return {
				exact:
					JSON.stringify(indexRowsOf({ db, seq })) ===
					JSON.stringify(recomputedIndexRowsOf({ db, seq })),
				answer: await holdersOf(engine),
			}
		}
		await expect(reclaimed()).resolves.toEqual({ exact: true, answer: ['c'] })
	})
})

/**
 * The index points at record rows by number. A full `VACUUM` may renumber the rows of a table without an
 * `INTEGER PRIMARY KEY` (the record tables have none), which would point the index at other records: the SQLite store
 * never runs one (its reclaim is `PRAGMA incremental_vacuum`, which keeps them). A lot that adds one rebuilds the
 * attribute indexes in the same transaction. The scan reads every SQL statement start in a string of the store's
 * sources: `VACUUM` at a string's start or after a `;`.
 */
const STORE_SOURCES = import.meta.glob<string>(['/src/store/**/*.ts', '!/src/store/**/*.test.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
})

const FULL_VACUUM = /(?:['"`]|;)\s*VACUUM\b/i

describe('the SQLite store and a full VACUUM', () => {
	it('the scan → catches a VACUUM statement at a string’s start and after a `;`, not the incremental reclaim or the auto-vacuum mode', () => {
		const sources = [
			"db.exec('VACUUM')",
			'db.exec(`PRAGMA x; vacuum INTO ?`)',
			"'PRAGMA incremental_vacuum(4)'",
			"'PRAGMA auto_vacuum=INCREMENTAL'",
		]
		expect(sources.map((source) => FULL_VACUUM.test(source))).toEqual([true, true, false, false])
	})

	it('the store’s sources → none runs a full VACUUM', () => {
		const files = Object.keys(STORE_SOURCES)
		const vacuuming = files.filter((path) => FULL_VACUUM.test(STORE_SOURCES[path]!))
		expect({ scanned: files.length > 20, vacuuming }).toEqual({ scanned: true, vacuuming: [] })
	})
})
