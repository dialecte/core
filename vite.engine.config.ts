import { fileURLToPath, URL } from 'node:url'

import { sqliteWasmEngineBuild } from './build/sqlite-wasm.plugin'

import { defineConfig } from 'vite'

/**
 * The `./engine` entry, built on its own: a dialecte's worker entry bundles it whole (a worker bundle
 * keeps nothing external), so it carries sqlite-wasm and comlink - sqlite-wasm without any asset of its
 * own (no wasm inlined, no worker1 chunk): the engine is handed the consumer's one wasm file. Written
 * into the main build's `dist`, which it leaves as it is; its declarations come from the main build.
 */
export default defineConfig({
	base: './',
	plugins: [sqliteWasmEngineBuild()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	build: {
		emptyOutDir: false,
		outDir: 'dist',
		lib: {
			entry: { engine: fileURLToPath(new URL('./src/engine.ts', import.meta.url)) },
			formats: ['es'],
		},
		rollupOptions: {
			output: {
				entryFileNames: '[name].js',
				chunkFileNames: 'engine-[name]-[hash].js',
			},
		},
	},
})
