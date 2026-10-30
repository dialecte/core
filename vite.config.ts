import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

// VITE
import { defineConfig } from 'vite'
// VITE PLUGINS
import dts from 'vite-plugin-dts'

// https://vite.dev/config/
export default defineConfig({
	// emitted assets resolved next to the module that needs them, wherever the package is installed
	base: './',
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
		// a config file runs in Node, where import.meta.env does not exist; Vite sets NODE_ENV to production for a
		// build unless it is set already: `NODE_ENV=development npm run build` gives maps
		sourcemap: process.env.NODE_ENV === 'development',
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
			// sqlite-wasm resolved by whoever loads core's main side (node finds its own wasm); the engine
			// build (vite.engine.config.ts) bundles it. libxml2-wasm, the test entry's XML engine, is bundled into
			// the test entry: it binds the console while its module loads, and must bind the forwarders the XML
			// seam puts on it first, an order an external import, hoisted above the bundled code, would not keep.
			// It stays a dependency all the same: the emitted type declarations import its types.
			external: ['vitest', /^@sqlite\.org\/sqlite-wasm/, 'comlink'],
			output: {
				entryFileNames: '[name].js',
			},
		},
	},
})
