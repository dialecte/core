import { globSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { benchCommands } from './src/store/sqlite/bench/bench-commands'
import viteConfig from './vite.config'

import { playwright } from '@vitest/browser-playwright'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'

import type { BrowserConfigOptions } from 'vitest/node'

const root = fileURLToPath(new URL('./', import.meta.url))

/** Every include pattern names at least one file: a moved test file must not drop out of its project unseen. */
function assertEachIncludeMatches(params: { project: string; include: string[] }): string[] {
	const { project, include } = params
	const unmatched = include.filter(function matchesNoFile(pattern) {
		return globSync(pattern, { cwd: root }).length === 0
	})
	if (unmatched.length > 0) {
		throw new Error(
			`vitest project "${project}" includes files that do not exist: ${unmatched.join(', ')}`,
		)
	}
	return include
}
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

// The unit suite runs on Chromium; UNIT_FIREFOX_EXECUTABLE runs it once on stock Firefox over BiDi instead (the
// engine's worker legs, best effort: Playwright's own Firefox build does not start on every macOS).
const unitInstances = (): BrowserConfigOptions['instances'] =>
	process.env.UNIT_FIREFOX_EXECUTABLE
		? [
				{
					browser: 'firefox',
					provider: playwright({
						launchOptions: {
							channel: 'moz-firefox',
							executablePath: process.env.UNIT_FIREFOX_EXECUTABLE,
						},
					}),
				},
			]
		: [{ browser: 'chromium' }]

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			watch: false,
			testTimeout: 5_000,
			projects: [
				{
					resolve: viteConfig.resolve,
					// sqlite-wasm resolves its wasm itself: a pre-bundled copy loses the file next to it
					optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
					plugins: [],
					test: {
						name: 'unit',
						browser: createBrowser(unitInstances()),
						include: ['src/**/*.test.{js,ts,jsx,tsx}'],
						exclude: [
							...configDefaults.exclude,
							'src/**/*.bench.test.{js,ts}',
							'src/store/sqlite/packaging/**',
						],
						root,
					},
				},
				{
					// the store contract and the project's store switch in node, on the in-memory store
					// and on IndexedDB through fake-indexeddb; the test files share their modules, as
					// a mutation runner's workers do. The hub router needs no browser either.
					resolve: viteConfig.resolve,
					plugins: [],
					test: {
						name: 'node',
						environment: 'node',
						isolate: false,
						include: assertEachIncludeMatches({
							project: 'node',
							include: [
								'src/store/contract/store-contract.test.ts',
								'src/project/store-switch.test.ts',
								'src/store/engine/hub/hub-router.test.ts',
								'src/store/sqlite/packaging/engine-packaging.test.ts',
							],
						}),
						setupFiles: ['src/store/contract/store-contract.node.setup.ts'],
						root,
					},
				},
				{
					resolve: viteConfig.resolve,
					// workers discover their dependencies late: pre-bundle them up front; sqlite-wasm resolves its wasm itself
					optimizeDeps: {
						include: ['comlink', 'sax'],
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
						browser: { ...createBrowser(benchInstances()), commands: benchCommands() },
						include: ['src/**/*.bench.test.{js,ts}'],
						root,
					},
				},
			],
		},
	}),
)
