/** The module of sqlite-wasm a bundler takes: the three default asset expressions live there. */
export const SQLITE_WASM_MODULE = /@sqlite\.org[/\\]sqlite-wasm[/\\]dist[/\\]index\.mjs$/

/**
 * sqlite-wasm's default asset expressions, each replaced by a throw: a bundler would otherwise inline
 * the wasm (a library build inlines every `new URL(asset, import.meta.url)`), inline the OPFS VFS's
 * async proxy and emit the 1.8 MB worker1 chunk. The engine hands sqlite-wasm the consumer's one wasm
 * file (`locateFile`) and runs neither worker1 nor the `opfs` VFS. Each must be found exactly once: a
 * version that moves one fails the build (the package is pinned to an exact version).
 */
export const DEFAULT_ASSET_EXPRESSIONS: Record<string, string> = {
	'default wasm URL': 'new URL("sqlite3.wasm", import.meta.url).href',
	'OPFS VFS async proxy': 'new URL("sqlite3-opfs-async-proxy.js", import.meta.url)',
	'worker1 promiser worker':
		'new Worker(new URL("sqlite3-worker1.mjs", import.meta.url), { type: "module" })',
}
