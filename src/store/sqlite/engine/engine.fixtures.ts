import { loadSqlite } from '../load-sqlite'
import { openSqliteEngine } from './sqlite-engine'

import type { SqliteEngine, SqliteEngineOptions } from './engine.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** The dialecte an engine test keeps in its files. */
export const ENGINE_TEST_DIALECTE_ID = 'core/test'

/**
 * An in-memory file of its own, empty: a keeper connection holds it, `connect` opens another one.
 * Every connection is added to `opened`, for the case to close after it (the file goes with the last).
 */
export async function openMemoryFile(params: {
	opened: Database[]
}): Promise<{ keeper: Database; connect: () => Database }> {
	const { opened } = params
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

/** An engine started on that connection, importing with `runtime` when given. */
export async function startEngine(params: {
	db: Database
	options?: Partial<SqliteEngineOptions>
	runtime?: StoreRuntime
}): Promise<SqliteEngine> {
	const { db, options, runtime } = params
	const sqlite3 = await loadSqlite()
	return openSqliteEngine({
		sqlite3,
		db,
		dialecteId: ENGINE_TEST_DIALECTE_ID,
		name: 'engine-test',
		runtime,
		options,
	})
}
