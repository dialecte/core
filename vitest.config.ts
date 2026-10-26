import { fileURLToPath } from 'node:url'

import { BENCH_COMMANDS } from './src/store/sqlite/bench/bench-commands'
import viteConfig from './vite.config'

import { playwright } from '@vitest/browser-playwright'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'

import type { BrowserConfigOptions } from 'vitest/node'

const root = fileURLToPath(new URL('./', import.meta.url))
const createBrowser = (
	instances: BrowserConfigOptions['instances'] = [{ browser: 'chromium' }],
): BrowserConfigOptions => ({
	provider: playwright(),
	enabled: true,
	headless: true,
	instances,
	screenshotFailures: false,
})
// Perf benches measure browser storage on disk: a default (off-the-record) context keeps OPFS and IndexedDB in
// memory, under a small quota. One profile directory per browser, git-ignored under .tmp; benches remove what they create.
// Playwright's patched Firefox does not start on every macOS: the bench's Firefox run uses stock Firefox over BiDi.
const benchProfile = (browser: string): string =>
	`${process.env.BENCH_PROFILE_DIR ?? `${root}.tmp/bench-profile`}-${browser}`
const benchInstances = (): BrowserConfigOptions['instances'] =>
	process.env.BENCH_FIREFOX_EXECUTABLE
		? [
				{
					browser: 'firefox',
					provider: playwright({
						persistentContext: benchProfile('firefox'),
						launchOptions: {
							channel: 'moz-firefox',
							executablePath: process.env.BENCH_FIREFOX_EXECUTABLE,
						},
					}),
				},
			]
		: [
				{
					browser: 'chromium',
					provider: playwright({ persistentContext: benchProfile('chromium') }),
				},
			]

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			watch: false,
			testTimeout: 5_000,
			projects: [
				{
					resolve: viteConfig.resolve,
					plugins: [],
					test: {
						name: 'unit',
						browser: createBrowser(),
						include: ['src/**/*.test.{js,ts,jsx,tsx}'],
						exclude: [...configDefaults.exclude, 'src/**/*.bench.test.{js,ts}'],
						root,
					},
				},
				{
					// the store contract and the project's store switch in node, on the in-memory store
					// and on IndexedDB through fake-indexeddb; the test files share their modules, as
					// a mutation runner's workers do
					resolve: viteConfig.resolve,
					plugins: [],
					test: {
						name: 'node',
						environment: 'node',
						isolate: false,
						include: [
							'src/store/contract/store-contract.test.ts',
							'src/project/store-switch.test.ts',
						],
						setupFiles: ['src/store/contract/store-contract.node.setup.ts'],
						root,
					},
				},
				{
					resolve: viteConfig.resolve,
					// workers discover their dependencies late: pre-bundle them up front; sqlite-wasm resolves its wasm itself
					optimizeDeps: {
						include: ['comlink', 'sax', 'xml-formatter'],
						exclude: ['@sqlite.org/sqlite-wasm'],
					},
					// the layout bench reads fixtures from another checkout (BENCH_SCL_FIXTURES_DIR)
					server: {
						fs: {
							allow: [
								root,
								...(process.env.BENCH_SCL_FIXTURES_DIR ? [process.env.BENCH_SCL_FIXTURES_DIR] : []),
							],
						},
					},
					plugins: [],
					test: {
						name: 'perf',
						testTimeout: 180_000,
						// one headless tab per bench file: one at a time on a shared machine
						fileParallelism: false,
						browser: { ...createBrowser(benchInstances()), commands: BENCH_COMMANDS },
						include: ['src/**/*.bench.test.{js,ts}'],
						root,
					},
				},
			],
		},
	}),
)
