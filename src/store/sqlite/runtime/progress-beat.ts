import type { Heartbeat } from '../served/host/host.types'
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * Beat from inside SQLite: its progress handler runs every `ops` virtual-machine steps of any
 * statement (an index build, a long read, a vacuum step), so one long statement keeps its callers.
 */
export function installProgressBeat(params: {
	sqlite3: Sqlite3Static
	db: Database
	heartbeat: Heartbeat
	ops: number
}): void {
	const { sqlite3, db, heartbeat, ops } = params
	sqlite3.capi.sqlite3_progress_handler(
		db,
		ops,
		function beatInStatement() {
			heartbeat.beat()
			// zero: the statement goes on
			return 0
		},
		0,
	)
}
