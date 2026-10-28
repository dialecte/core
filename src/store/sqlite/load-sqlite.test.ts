import { loadSqlite } from './load-sqlite'
import { SQLITE_WASM_URL } from './sqlite-wasm-url'

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('loadSqlite', () => {
	it('the first load of the realm given the wasm URL → SQLite fetched from that URL', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch')
		const sqlite3 = await loadSqlite({ wasmUrl: SQLITE_WASM_URL })
		expect(sqlite3.version.libVersion).toMatch(/^3\./)
		expect(fetchSpy.mock.calls.map(([input]) => String(input))).toContain(SQLITE_WASM_URL)
	})

	it('loaded from one wasm file, asked again with another → ASSERTION_FAILED: one wasm file per realm', async () => {
		await loadSqlite({ wasmUrl: SQLITE_WASM_URL })
		expect(() => loadSqlite({ wasmUrl: `${SQLITE_WASM_URL}#another` })).toThrow(
			/one wasm file per realm/,
		)
		await expect(loadSqlite({ wasmUrl: SQLITE_WASM_URL })).resolves.toBeDefined()
	})
})
