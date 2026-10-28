import { DEFAULT_ASSET_EXPRESSIONS, SQLITE_WASM_MODULE } from './sqlite-wasm.plugin.constants'

import type { Plugin } from 'vite'

/** The engine build's step on sqlite-wasm: its default asset expressions made throws (`DEFAULT_ASSET_EXPRESSIONS`). */
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
