import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** What sqlite-wasm reads from `globalThis.sqlite3ApiConfig` as it starts (the part the store sets). */
export type SqliteApiConfig = {
	disable?: { vfs?: Record<string, boolean> }
}

/**
 * sqlite-wasm's init as it runs: it takes the Emscripten module's `locateFile` (its declared type
 * takes nothing).
 */
export type SqliteInit = (moduleConfig?: {
	locateFile?: (path: string, prefix: string) => string
}) => Promise<Sqlite3Static>
