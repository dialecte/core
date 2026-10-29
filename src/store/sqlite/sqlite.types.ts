import type { Sqlite3Static, WasmPointer } from '@sqlite.org/sqlite-wasm'

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

/**
 * The members of sqlite-wasm's `wasm` utilities its text codec runs through (not all in its declared
 * types): its column reader decodes through `typedArrayToString`, its binders encode through
 * `allocCString`, both looked up at each call; `typedArrayPart`, `alloc` and `heap8u` are what a
 * replacement of the two needs.
 */
export type SqliteWasmText = {
	typedArrayToString: (array: Uint8Array, begin?: number, end?: number) => string
	typedArrayPart: (array: Uint8Array, begin?: number, end?: number) => Uint8Array
	allocCString: (text: unknown, returnWithLength?: boolean) => SqliteCString
	alloc: (bytes: number) => WasmPointer
	heap8u: () => Uint8Array
}

/** What `allocCString` answers: the string's pointer, with its length in bytes when asked, `null` for a non-string. */
export type SqliteCString = WasmPointer | [WasmPointer, number] | null

/** A statement run on SQLite as a realm loads it: `bind` bound in order, `expected` its one answer. */
export type SqliteTextCase = { sql: string; bind: unknown[]; expected: unknown }
