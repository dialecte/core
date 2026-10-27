import { throwDialecteError } from '@/errors'

import type { ImportWindow, ImportWindowParams, ImportWindowState } from './engine.types'

/**
 * The window transactions of one import. Its writes go into a transaction that commits after about
 * `windowMs` of work, with synchronous off (the rollback journal kept: a failed import rolls back
 * what is open, then its document is dropped) and the import cache, raised at its first write and
 * held until it ends (lowering it between two transactions would read the import's pages again).
 * Commits are tallied as `import::commit`.
 *
 * A write of another connection settles the window first: what is open is committed and the
 * connection is durable again (synchronous full), so that write lands at once, on its own, and stays
 * whatever becomes of the import; the import opens its next window at its next write. A commit that
 * fails there loses the window's records: the import is then refused at its next window
 * (`STORE_COMMIT_FAILED`), never ready without them.
 */
export function createImportWindow(params: ImportWindowParams): ImportWindow {
	const state: ImportWindowState = {
		openedAt: undefined,
		synchronousOff: false,
		cacheRaised: false,
		lost: undefined,
	}
	return {
		write: function write(work) {
			openWindow({ params, state })
			return work()
		},
		commitIfDue: function commitIfDue() {
			if (state.openedAt === undefined) return false
			if (performance.now() - state.openedAt < params.windowMs) return false
			commitWindow({ params, state })
			return true
		},
		alone: function alone(work) {
			commitWindow({ params, state })
			openWindow({ params, state })
			const result = work()
			commitWindow({ params, state })
			return result
		},
		settle: function settle() {
			const { sqlite3, db } = params
			try {
				commitWindow({ params, state })
			} catch (thrown) {
				// the commit may have left the transaction open: its records are gone either way
				if (sqlite3.capi.sqlite3_get_autocommit(db) === 0) db.exec('ROLLBACK')
				state.openedAt = undefined
				state.lost = thrown instanceof Error ? thrown : new Error(String(thrown))
				throw thrown
			}
			makeSynchronous({ params, state })
		},
		finish: function finish() {
			refuseLost({ state })
			commitWindow({ params, state })
			makeSynchronous({ params, state })
			restoreSteadyCache({ params, state })
		},
		/**
		 * The window rolled back, the connection durable again at its steady cache, whatever happens: a
		 * rollback that fails is thrown, but what the window held is committed first so no transaction is
		 * left open (SQLite refuses to change synchronous inside one, and every later write would fail to
		 * begin). Those rows are the failed import's own, in its own table, which its removal drops or the
		 * next engine start sweeps (its row is still `importing`); a connection cannot be reopened in place.
		 */
		end: function end() {
			if (!params.db.isOpen()) return
			const { sqlite3, db } = params
			try {
				// its own transaction only; an I/O, full or out-of-memory error may have rolled it back already
				if (state.openedAt !== undefined && sqlite3.capi.sqlite3_get_autocommit(db) === 0) {
					db.exec('ROLLBACK')
				}
			} finally {
				try {
					if (sqlite3.capi.sqlite3_get_autocommit(db) === 0) db.exec('COMMIT')
				} finally {
					restoreSteadyCache({ params, state })
					if (sqlite3.capi.sqlite3_get_autocommit(db) !== 0) {
						state.openedAt = undefined
						makeSynchronous({ params, state })
					}
				}
			}
		},
	}
}

function openWindow(params: { params: ImportWindowParams; state: ImportWindowState }): void {
	const { state } = params
	const { db, importCacheMiB } = params.params
	refuseLost({ state })
	if (state.openedAt !== undefined) return
	if (!state.cacheRaised) {
		db.exec(`PRAGMA cache_size=${-importCacheMiB * 1024}`)
		state.cacheRaised = true
	}
	if (!state.synchronousOff) {
		db.exec('PRAGMA synchronous=OFF')
		state.synchronousOff = true
	}
	db.exec('BEGIN IMMEDIATE')
	state.openedAt = performance.now()
}

function commitWindow(params: { params: ImportWindowParams; state: ImportWindowState }): void {
	const { state } = params
	const { db, perf } = params.params
	if (state.openedAt === undefined) return
	perf.time('import::commit', function commit() {
		db.exec('COMMIT')
	})
	state.openedAt = undefined
}

/** A window lost to a failed commit: the import goes no further. */
function refuseLost(params: { state: ImportWindowState }): void {
	const { lost } = params.state
	if (!lost) return
	throwDialecteError('STORE_COMMIT_FAILED', {
		detail: `The import's records could not be committed: ${lost.message}`,
		cause: lost,
	})
}

function makeSynchronous(params: { params: ImportWindowParams; state: ImportWindowState }): void {
	const { state } = params
	if (!state.synchronousOff) return
	params.params.db.exec('PRAGMA synchronous=FULL')
	state.synchronousOff = false
}

function restoreSteadyCache(params: {
	params: ImportWindowParams
	state: ImportWindowState
}): void {
	const { state } = params
	const { db, steadyCacheMiB } = params.params
	if (!state.cacheRaised) return
	db.exec(`PRAGMA cache_size=${-steadyCacheMiB * 1024}`)
	state.cacheRaised = false
}

/**
 * End the window of an import that failed: the connection durable again; a failure of the rollback is
 * dropped (not thrown, not attached), the import's own failure is the one to report.
 */
export function endQuietly(params: { window: ImportWindow }): void {
	try {
		params.window.end()
	} catch {
		// the connection is in its durable state already; the next engine start sweeps what the import left
	}
}
