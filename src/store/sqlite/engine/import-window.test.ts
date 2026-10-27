import { loadSqlite } from '../load-sqlite'
import { openMemoryFile } from './engine.fixtures'
import { createImportWindow } from './import-window'

import { afterEach, describe, expect, it } from 'vitest'

import { NOOP_PERF } from '@/perf'

import type { Database } from '@sqlite.org/sqlite-wasm'

/** The databases a case opened, closed after it. */
const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

describe('an import window', () => {
	it('ended while its rollback fails → the rollback’s failure thrown; no transaction left open (what it held committed, for the caller to drop), the connection durable at its steady cache', async () => {
		const sqlite3 = await loadSqlite()
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		db.exec('PRAGMA synchronous=FULL; PRAGMA cache_size=-8192; CREATE TABLE t (x)')
		const window = createImportWindow({
			sqlite3,
			db,
			perf: NOOP_PERF,
			windowMs: 1000,
			importCacheMiB: 64,
			steadyCacheMiB: 8,
		})
		window.write(function insertOne() {
			db.exec('INSERT INTO t VALUES (1)')
		})
		const exec = db.exec.bind(db) as (...args: unknown[]) => unknown
		db.exec = function refuseRollback(...args: unknown[]) {
			if (args[0] === 'ROLLBACK') throw new Error('rollback refused')
			return exec(...args)
		} as unknown as Database['exec']
		try {
			expect(() => window.end()).toThrow('rollback refused')
		} finally {
			db.exec = exec as unknown as Database['exec']
		}
		expect(sqlite3.capi.sqlite3_get_autocommit(db)).not.toBe(0)
		expect(db.selectValue('PRAGMA synchronous')).toBe(2)
		expect(db.selectValue('PRAGMA cache_size')).toBe(-8192)
		expect(db.selectValue('SELECT count(*) FROM t')).toBe(1)
	})
})
