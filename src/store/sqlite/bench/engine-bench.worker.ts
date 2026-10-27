import { RECORD_COLUMN_LIST } from '../engine/engine.constants'
import { openSqliteEngine } from '../engine/sqlite-engine'
import { inWriteTransaction } from '../engine/transaction'
import { loadSqlite } from '../load-sqlite'
import { createBenchImportRuntime, stagesOf } from './bench-import-session'
import { installPool } from './bench-pool'
import {
	ENGINE_BENCH_DATABASE_PATH,
	ENGINE_BENCH_DIALECTE_ID,
	FILL_ATTRIBUTE_BYTES,
	FILL_ROWS_PER_TRANSACTION,
} from './bench.constants'

import * as Comlink from 'comlink'

import { TABLE_DOCUMENTS, TABLE_RECORD_PREFIX } from '@/store/store.constants'

import type { EngineBenchWorkerApi, FilePages } from './bench.types'
import type { DocumentRecord, DocumentStatus } from '@/project/types'
import type { Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * The engine bench's worker: the real engine on a real OPFS pool (sahpool needs a worker). Each call
 * installs its own pool and removes it after.
 */
const api: EngineBenchWorkerApi = {
	importOnOpfs: async function importOnOpfs({ file, project, root, afterImportRatio }) {
		const sqlite3 = await loadSqlite()
		const pool = await installPool({ sqlite3, project })
		try {
			const db = new pool.OpfsSAHPoolDb(ENGINE_BENCH_DATABASE_PATH)
			const engine = openSqliteEngine({
				sqlite3,
				db,
				dialecteId: ENGINE_BENCH_DIALECTE_ID,
				name: project,
				runtime: createBenchImportRuntime({ root, afterImportRatio }),
			})
			try {
				const startedAt = performance.now()
				const result = await engine.importFile({ file, writeId: 'w-bench', clientId: 'bench' })
				const dropToReadyMs = performance.now() - startedAt
				const { pages, pageSize } = pagesOf({ db })
				return {
					dropToReadyMs,
					recordCount: result.recordCount,
					stages: stagesOf({ snapshot: result.perf }),
					databaseBytes: pages * pageSize,
				}
			} finally {
				engine.close()
			}
		} finally {
			await removePool({ pool })
		}
	},

	/**
	 * A dead import (an `importing` document without indexes, filled first) in front of a ready
	 * document (with its indexes): the engine starts again on the file and removes the dead one,
	 * then gives its pages back - each part timed as the engine runs it.
	 */
	measureStart: async function measureStart({ project, deadRows, readyRows }) {
		const sqlite3 = await loadSqlite()
		const pool = await installPool({ sqlite3, project })
		try {
			const fillMs = await fillFile({ sqlite3, pool, project, deadRows, readyRows })
			const db = new pool.OpfsSAHPoolDb(ENGINE_BENCH_DATABASE_PATH)
			const before = pagesOf({ db })
			const startedAt = performance.now()
			const engine = openSqliteEngine({
				sqlite3,
				db,
				dialecteId: ENGINE_BENCH_DIALECTE_ID,
				name: project,
			})
			const startMs = performance.now() - startedAt
			try {
				const cacheMiB = -Number(db.selectValue('PRAGMA cache_size')) / 1024
				const after = pagesOf({ db })
				engine.close()
				const restartMs = timed({
					work: function restart() {
						openSqliteEngine({
							sqlite3,
							db: new pool.OpfsSAHPoolDb(ENGINE_BENCH_DATABASE_PATH),
							dialecteId: ENGINE_BENCH_DIALECTE_ID,
							name: project,
						}).close()
					},
				})
				return { deadRows, readyRows, fillMs, before, startMs, cacheMiB, after, restartMs }
			} finally {
				if (db.isOpen()) engine.close()
			}
		} finally {
			await removePool({ pool })
		}
	},
}

Comlink.expose(api)

function benchDocument(params: { id: string; status: DocumentStatus }): DocumentRecord {
	return {
		id: params.id,
		name: params.id,
		extension: '.scd',
		configKey: 'default',
		createdAt: Date.now(),
		status: params.status,
	}
}

function tableOf(params: { db: Database; documentId: string }): string {
	const { db, documentId } = params
	const seq = db.selectValue(`SELECT seq FROM ${TABLE_DOCUMENTS} WHERE id = ?`, [documentId])
	return `${TABLE_RECORD_PREFIX}${seq}`
}

/**
 * Rows shaped like imported records (an id, a parent, one attribute of `FILL_ATTRIBUTE_BYTES` random
 * bytes as hex), written by SQLite itself, `FILL_ROWS_PER_TRANSACTION` per transaction.
 */
function fillRows(params: {
	sqlite3: Sqlite3Static
	db: Database
	table: string
	rows: number
	prefix: string
}): void {
	const { sqlite3, db, table, rows, prefix } = params
	for (let first = 1; first <= rows; first += FILL_ROWS_PER_TRANSACTION) {
		const last = Math.min(rows, first + FILL_ROWS_PER_TRANSACTION - 1)
		inWriteTransaction({
			sqlite3,
			db,
			work: function fillBatch() {
				db.exec({
					sql:
						'WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i + 1 FROM n WHERE i < ?) ' +
						`INSERT INTO ${table} (${RECORD_COLUMN_LIST}) ` +
						`SELECT printf('${prefix}%09d', i), 'T', '', 'u', '', printf('${prefix}%09d', i / 8), 'T', ` +
						`json_array(json_object('name', 'a', 'value', hex(randomblob(${FILL_ATTRIBUTE_BYTES})))), '[]' FROM n`,
					bind: [first, last],
				})
			},
		})
	}
}

function pagesOf(params: { db: Database }): FilePages {
	const { db } = params
	return {
		pages: Number(db.selectValue('PRAGMA page_count')),
		freePages: Number(db.selectValue('PRAGMA freelist_count')),
		pageSize: Number(db.selectValue('PRAGMA page_size')),
	}
}

function timed(params: { work: () => void }): number {
	const startedAt = performance.now()
	params.work()
	return performance.now() - startedAt
}

/**
 * The file of an engine-start cell: a dead import (an `importing` document whose table has no index
 * yet, as an import leaves it before its id index) filled first, then a ready document with its
 * indexes; the engine that wrote them closed. Answers how long each fill took.
 */
async function fillFile(params: {
	sqlite3: Sqlite3Static
	pool: SAHPoolUtil
	project: string
	deadRows: number
	readyRows: number
}): Promise<{ dead: number; ready: number }> {
	const { sqlite3, pool, project, deadRows, readyRows } = params
	const db = new pool.OpfsSAHPoolDb(ENGINE_BENCH_DATABASE_PATH)
	const engine = openSqliteEngine({
		sqlite3,
		db,
		dialecteId: ENGINE_BENCH_DIALECTE_ID,
		name: project,
	})
	try {
		const deadStartedAt = performance.now()
		await engine.registerDocument(benchDocument({ id: 'dead', status: 'importing' }))
		const deadTable = tableOf({ db, documentId: 'dead' })
		db.exec(`DROP INDEX ${deadTable}_id; DROP INDEX ${deadTable}_tag;`)
		fillRows({ sqlite3, db, table: deadTable, rows: deadRows, prefix: 'd' })
		const readyStartedAt = performance.now()
		await engine.registerDocument(benchDocument({ id: 'ready', status: 'ready' }))
		fillRows({
			sqlite3,
			db,
			table: tableOf({ db, documentId: 'ready' }),
			rows: readyRows,
			prefix: 'r',
		})
		return { dead: readyStartedAt - deadStartedAt, ready: performance.now() - readyStartedAt }
	} finally {
		engine.close()
	}
}

/** The run's pool gone with its files: the next run starts on an empty one. */
async function removePool(params: { pool: SAHPoolUtil }): Promise<void> {
	await params.pool.removeVfs()
}
