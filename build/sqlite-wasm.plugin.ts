import type { Plugin } from 'vite'

/** The module of sqlite-wasm a bundler takes: the three default asset expressions live there. */
const SQLITE_WASM_MODULE = /@sqlite\.org[/\\]sqlite-wasm[/\\]dist[/\\]index\.mjs$/

/**
 * sqlite-wasm's default asset expressions, each replaced by a throw: a bundler would otherwise inline
 * the wasm (a library build inlines every `new URL(asset, import.meta.url)`), inline the OPFS VFS's
 * async proxy and emit the 1.8 MB worker1 chunk. The engine hands sqlite-wasm the consumer's one wasm
 * file (`locateFile`) and runs neither worker1 nor the `opfs` VFS. Each must be found exactly once: a
 * version that moves one fails the build (the package is pinned to an exact version).
 */
const DEFAULT_ASSET_EXPRESSIONS: Record<string, string> = {
	'default wasm URL': 'new URL("sqlite3.wasm", import.meta.url).href',
	'OPFS VFS async proxy': 'new URL("sqlite3-opfs-async-proxy.js", import.meta.url)',
	'worker1 promiser worker':
		'new Worker(new URL("sqlite3-worker1.mjs", import.meta.url), { type: "module" })',
}

/** The engine build's step on sqlite-wasm: its default asset expressions made throws (see above). */
export function sqliteWasmEngineBuild(): Plugin {
	return {
		name: 'dialecte:sqlite-wasm-engine-build',
		enforce: 'pre',
		transform: {
			filter: { id: SQLITE_WASM_MODULE },
			handler(code) {
				let transformed = code
				for (const [what, expression] of Object.entries(DEFAULT_ASSET_EXPRESSIONS)) {
					const found = transformed.split(expression).length - 1
					if (found !== 1) {
						this.error(
							`sqlite-wasm: ${what} (\`${expression}\`) found ${found} times instead of once: check the pinned version`,
						)
					}
					transformed = transformed.replace(
						expression,
						`(() => { throw new Error("sqlite-wasm's ${what} is not served by @dialecte/core's engine (it hands sqlite-wasm its wasm through locateFile)") })()`,
					)
				}
				return { code: transformed, map: null }
			},
		},
	}
}
