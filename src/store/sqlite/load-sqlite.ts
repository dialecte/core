import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm'

let loading: Promise<Sqlite3Static> | undefined

/** The SQLite module of this realm, loaded once (its wasm resolved next to the package). */
export function loadSqlite(): Promise<Sqlite3Static> {
	loading ??= sqlite3InitModule()
	return loading
}
