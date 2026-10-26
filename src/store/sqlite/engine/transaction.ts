import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * Run `work` in one write transaction: committed when it returns, rolled back when it throws - unless
 * SQLite has already rolled it back (an I/O, full or out-of-memory error does), so the error thrown
 * is always the one that failed the work.
 */
export function inWriteTransaction<GenericResult>(params: {
	sqlite3: Sqlite3Static
	db: Database
	work: () => GenericResult
}): GenericResult {
	const { sqlite3, db, work } = params
	db.exec('BEGIN IMMEDIATE')
	try {
		const result = work()
		db.exec('COMMIT')
		return result
	} catch (thrown) {
		if (sqlite3.capi.sqlite3_get_autocommit(db) === 0) db.exec('ROLLBACK')
		throw thrown
	}
}
