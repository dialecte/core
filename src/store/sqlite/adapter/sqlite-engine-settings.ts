import { createDialecteError } from '@/errors'

import type { SqliteEngineSettings } from '../runtime/runtime.types'

/**
 * What a SQLite engine opens with by default: the consumer's one wasm file. Its URL module is loaded here, at the
 * first engine a page starts: a page that never opens a project on SQLite never fetches it. A module that cannot be
 * loaded (offline, a chunk gone after a deploy) fails the engine's start `STORE_CONNECTION_FAILED`.
 */
export async function loadSqliteEngineSettings(
	params: Omit<SqliteEngineSettings, 'wasmUrl'> = {},
): Promise<SqliteEngineSettings> {
	try {
		const { SQLITE_WASM_URL } = await import('../sqlite-wasm-url')
		return { ...params, wasmUrl: SQLITE_WASM_URL }
	} catch (thrown) {
		throw createDialecteError('STORE_CONNECTION_FAILED', {
			detail: `The SQLite engine's files could not be loaded: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
			cause: thrown instanceof Error ? thrown : undefined,
		})
	}
}
