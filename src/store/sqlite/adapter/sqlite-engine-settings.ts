import { SQLITE_WASM_URL } from '../sqlite-wasm-url'

import type { SqliteEngineSettings } from '../runtime/runtime.types'

/** What a SQLite engine opens with by default: the consumer's one wasm file, fetched by the engine at its open. */
export function sqliteEngineSettings(
	params: Omit<SqliteEngineSettings, 'wasmUrl'> = {},
): SqliteEngineSettings {
	return { ...params, wasmUrl: SQLITE_WASM_URL }
}
