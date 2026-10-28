/**
 * The one SQLite wasm file of a consumer: a consumer's bundler emits it once, content-hashed, for
 * every dialecte engine (each engine is handed this URL, its own bundle holds no wasm). Main-realm
 * code only: in node it points nowhere (sqlite-wasm's node build finds its own file).
 */
export const SQLITE_WASM_URL = new URL(
	'@sqlite.org/sqlite-wasm/sqlite3.wasm?no-inline',
	import.meta.url,
).href

/** The wasm URL a realm loads SQLite from: the consumer's file in a browser, none in node. */
export function realmWasmUrl(): string | undefined {
	const runsInNode = typeof globalThis.process?.versions?.node === 'string'
	return runsInNode ? undefined : SQLITE_WASM_URL
}
