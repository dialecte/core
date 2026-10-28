import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
/// <reference types="vite/client" />
import { fileURLToPath, URL } from 'node:url'

// VITE
import { defineConfig } from 'vite'
// VITE PLUGINS
import dts from 'vite-plugin-dts'

import type { Plugin } from 'vite'

/**
 * Copies the XSDs of core's test dialecte into `dist/test/xsd/` once the bundle is written, shipped as
 * `@dialecte/core/test/xsd/*` so a consumer can validate against them: `test.xsd` imports `test-ext.xsd` by a
 * relative path, so the two stay side by side.
 */
function shipTestSchemas(): Plugin {
	return {
		name: 'ship-test-schemas',
		apply: 'build',
		closeBundle() {
			const target = path.resolve(__dirname, 'dist/test/xsd')
			mkdirSync(target, { recursive: true })
			for (const file of ['test.xsd', 'test-ext.xsd'])
				copyFileSync(path.resolve(__dirname, 'src/test/generated', file), path.join(target, file))
		},
	}
}

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		dts({
			tsconfigPath: path.resolve(__dirname, './tsconfig.build.json'),
			insertTypesEntry: true,
		}),
		shipTestSchemas(),
	],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	build: {
		sourcemap: import.meta.env?.DEV,
		lib: {
			entry: {
				index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
				test: fileURLToPath(new URL('./src/test/index.ts', import.meta.url)),
				utils: fileURLToPath(new URL('./src/utils/index.ts', import.meta.url)),
				helpers: fileURLToPath(new URL('./src/helpers/index.ts', import.meta.url)),
			},
			name: 'ForgeKitCore',
			formats: ['es'],
		},
		rollupOptions: {
			external: ['vitest'],
			output: {
				entryFileNames: '[name].js',
			},
		},
	},
})
