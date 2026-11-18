import { contractFile, makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { createContractRuntime } from '../../contract/store-contract.import-session'
import { indexRowsOf, pairStatesOf, recomputedIndexRowsOf, seqOf } from './attribute-index.fixtures'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'

import type { SqliteEngine } from './engine.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

const DOCUMENT_ID = 'doc-1'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []
/** Holds a case left waiting, let go after it. */
const holds: (() => void)[] = []

afterEach(() => {
	vi.restoreAllMocks()
	for (const release of holds.splice(0)) release()
	for (const db of opened.splice(0)) db.close()
})

/** 5,000 records of A, `r0000`..`r4999`, each holding k = its number modulo 7. */
const MANY = Array.from({ length: 5_000 }, (_, index) =>
	makeRecord({
		id: `r${String(index).padStart(4, '0')}`,
		tagName: 'A',
		attributes: [{ name: 'k', value: String(index % 7) }],
	}),
)

/** The ids of A holding k="3" the engine answers on the document. */
async function holdersOf(engine: SqliteEngine): Promise<string[]> {
	const records = await engine.getByAttributes({
		documentId: DOCUMENT_ID,
		tagName: 'A',
		attributes: [{ name: 'k', values: ['3'] }],
	})
	return records.map((record) => record.id)
}

/** Let the engine's background work have many turns. */
async function manyTurns(): Promise<void> {
	for (let turn = 0; turn < 50; turn += 1) await new Promise((resolve) => setTimeout(resolve))
}

/** Whether the document's index rows equal their recomputation from its records. */
function isExact(params: { db: Database; seq: number }): boolean {
	return JSON.stringify(indexRowsOf(params)) === JSON.stringify(recomputedIndexRowsOf(params))
}

describe('a pair whose build fails', () => {
	it('the file full at the first lookup → the build rolled back, nothing registered, the lookups answered by filter, a write lands, no new try by that engine; the next engine builds it in its first lookup, exact', async () => {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		const engine = await startEngine({ db })
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite(DOCUMENT_ID, { creates: MANY })
		const seq = seqOf({ db, documentId: DOCUMENT_ID })
		async function refusedThenBuilt(): Promise<Record<string, unknown>> {
			// the file may grow no more: the index's pages cannot be added
			db.exec(`PRAGMA max_page_count = ${Number(db.selectValue('PRAGMA page_count'))}`)
			const first = await holdersOf(engine)
			const afterRefusal = pairStatesOf({ db, seq })
			db.exec('PRAGMA max_page_count = 1073741823')
			await engine.bulkWrite(DOCUMENT_ID, {
				creates: [makeRecord({ id: 'new', tagName: 'A', attributes: [{ name: 'k', value: '3' }] })],
				deletes: ['r0003'],
			})
			const meanwhile = await holdersOf(engine)
			await manyTurns()
			const sameEngine = pairStatesOf({ db, seq })
			engine.close()
			const nextDb = file.connect()
			const next = await startEngine({ db: nextDb })
			const built = await holdersOf(next)
			return {
				first: first.length,
				afterRefusal,
				meanwhile: meanwhile.length,
				sameEngine,
				nextEngine: pairStatesOf({ db: nextDb, seq }),
				built: built.length,
				exact: isExact({ db: nextDb, seq }),
			}
		}
		// 714 hold 3 (index % 7); then one more (new), one fewer (r0003)
		await expect(refusedThenBuilt()).resolves.toEqual({
			first: 714,
			afterRefusal: {},
			meanwhile: 714,
			sameEngine: {},
			nextEngine: { 'A.k': 'ready' },
			built: 714,
			exact: true,
		})
	})
})

/** A failure SQLite reports as a disk I/O error, by its result code (`SQLITE_IOERR`): one the engine gives a build up on. */
function ioFailure(params: { sql: string }): Error {
	return Object.assign(new Error(`${params.sql.slice(0, 40)}: disk I/O error`), { resultCode: 10 })
}

describe('a build whose rollback fails', () => {
	it('the build and then its ROLLBACK refused with an I/O error → the connection left inside its transaction: the engine broken and told once, the lookup refused, nothing written; the next engine builds the pair, exact', async () => {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		let told = 0
		const engine = await startEngine({
			db,
			onBroken: function countBroken() {
				told += 1
			},
		})
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite(DOCUMENT_ID, { creates: MANY })
		const seq = seqOf({ db, documentId: DOCUMENT_ID })
		const armed = { failing: false }
		const exec = db.exec.bind(db) as (...args: unknown[]) => unknown
		vi.spyOn(db, 'exec').mockImplementation(function execUnlessArmed(...args: unknown[]) {
			const [first] = args
			const sql = typeof first === 'string' ? first : ((first as { sql?: string }).sql ?? '')
			// the build's rows refused, then its rollback: SQLite rolled nothing back, the transaction stays open
			if (armed.failing && (sql.startsWith('INSERT OR IGNORE INTO xattr_') || sql === 'ROLLBACK')) {
				throw ioFailure({ sql })
			}
			return exec(...args)
		} as typeof db.exec)
		async function strandedThenNext(): Promise<Record<string, unknown>> {
			armed.failing = true
			const lookup = await holdersOf(engine).then(
				() => 'answered',
				(thrown: unknown) => toDialecteError(thrown)?.key,
			)
			armed.failing = false
			const nextDb = file.connect()
			const next = await startEngine({ db: nextDb })
			const leftByTheBrokenEngine = pairStatesOf({ db: nextDb, seq })
			const built = await holdersOf(next)
			return {
				told,
				closed: !db.isOpen(),
				lookup,
				leftByTheBrokenEngine,
				built: built.length,
				nextEngine: pairStatesOf({ db: nextDb, seq }),
				exact: isExact({ db: nextDb, seq }),
			}
		}
		// 714 of the 5,000 hold 3 (index % 7)
		await expect(strandedThenNext()).resolves.toEqual({
			told: 1,
			closed: true,
			lookup: 'STORE_COMMIT_FAILED',
			leftByTheBrokenEngine: {},
			built: 714,
			nextEngine: { 'A.k': 'ready' },
			exact: true,
		})
	})
})

describe('a lookup while another document imports', () => {
	it('the first lookup of a pair meanwhile → answered by filter, nothing registered while the import runs; the first lookup after it builds the pair', async () => {
		const reached = Promise.withResolvers<void>()
		const released = Promise.withResolvers<void>()
		holds.push(released.resolve)
		const runtime: StoreRuntime = {
			...createContractRuntime(),
			hooks: {
				createImportSession: function createHeldSession() {
					return {
						afterImport: async function holdUntilReleased() {
							reached.resolve()
							await released.promise
							return {}
						},
					}
				},
			},
		}
		const db = (await openMemoryFile({ opened })).connect()
		const engine = await startEngine({ db, runtime })
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite(DOCUMENT_ID, { creates: MANY.slice(0, 70) })
		const seq = seqOf({ db, documentId: DOCUMENT_ID })
		async function duringThenAfter(): Promise<Record<string, unknown>> {
			const importing = engine.importFile({
				file: contractFile({ body: '<A/>' }),
				writeId: 'w-1',
				clientId: 'c-1',
			})
			await reached.promise
			const during = await holdersOf(engine)
			await manyTurns()
			const whileImporting = pairStatesOf({ db, seq })
			released.resolve()
			await importing
			await manyTurns()
			const afterImport = pairStatesOf({ db, seq })
			const after = await holdersOf(engine)
			return {
				during,
				whileImporting,
				afterImport,
				after,
				built: pairStatesOf({ db, seq }),
				exact: isExact({ db, seq }),
			}
		}
		const holding = [
			'r0003',
			'r0010',
			'r0017',
			'r0024',
			'r0031',
			'r0038',
			'r0045',
			'r0052',
			'r0059',
			'r0066',
		]
		await expect(duringThenAfter()).resolves.toEqual({
			during: holding,
			whileImporting: {},
			afterImport: {},
			after: holding,
			built: { 'A.k': 'ready' },
			exact: true,
		})
	})
})
