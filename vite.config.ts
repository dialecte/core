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
			entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
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
