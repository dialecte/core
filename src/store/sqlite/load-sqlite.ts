import { installLosslessText } from './sqlite-text'
import { SQLITE_VFS_DISABLED } from './sqlite.constants'

import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

import { createDialecteError } from '@/errors'

import type { SqliteApiConfig, SqliteInit } from './sqlite.types'
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** sqlite-wasm's init as it runs: it reads the module's `locateFile`. */
const initSqlite = sqlite3InitModule as SqliteInit

let loading: Promise<Sqlite3Static> | undefined
/** The wasm URL the realm's SQLite was loaded from, when one was given. */
let loadedFrom: string | undefined

/**
 * The SQLite module of this realm, loaded once: its wasm fetched from `wasmUrl` when given (a page or
 * an engine worker: the consumer's one wasm file), else found by the package itself (node, and core's
 * own tests). A later call naming another wasm file is refused (`ASSERTION_FAILED`). The VFSes the
 * engine never uses are not installed; its text codec is made lossless (`installLosslessText`).
 */
export function loadSqlite(params: { wasmUrl?: string } = {}): Promise<Sqlite3Static> {
	const { wasmUrl } = params
	const realm = globalThis as typeof globalThis & { sqlite3ApiConfig?: SqliteApiConfig }
	realm.sqlite3ApiConfig = { ...realm.sqlite3ApiConfig, disable: { vfs: SQLITE_VFS_DISABLED } }
	if (wasmUrl !== undefined && loadedFrom !== undefined && wasmUrl !== loadedFrom) {
		throw createDialecteError('ASSERTION_FAILED', {
			detail: `SQLite is loaded in this realm from "${loadedFrom}", not from "${wasmUrl}": one wasm file per realm`,
		})
	}
	if (!loading) loadedFrom = wasmUrl
	loading ??= (
		wasmUrl
			? initSqlite({
					locateFile: function wasmFile() {
						return wasmUrl
					},
				})
			: initSqlite()
	).then(function withLosslessText(sqlite3) {
		installLosslessText({ sqlite3 })
		return sqlite3
	})
	return loading
}
