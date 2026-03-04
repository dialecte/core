import path from 'node:path'
/// <reference types="vite/client" />
import { fileURLToPath, URL } from 'node:url'

// VITE
import { defineConfig } from 'vite'
// VITE PLUGINS
import dts from 'vite-plugin-dts'

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		dts({
			tsconfigPath: path.resolve(__dirname, './tsconfig.build.json'),
			insertTypesEntry: true,
		}),
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
				test: fileURLToPath(new URL('./src/test-fixtures/index.ts', import.meta.url)),
				utils: fileURLToPath(new URL('./src/utils/index.ts', import.meta.url)),
				helpers: fileURLToPath(new URL('./src/helpers/index.ts', import.meta.url)),
			},
			name: 'ForgeKitCore',
			formats: ['es'],
		},
		rollupOptions: {
			output: {
				entryFileNames: '[name].js',
			},
		},
	},
})
