import { globSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { benchCommands } from './src/store/sqlite/bench/bench-commands'
import viteConfig from './vite.config'
import {
	BENCH_TEST_PATTERN,
	BROWSER_GROUP_ORDER,
	BROWSER_ONLY_TEST_FILES,
	NODE_ONLY_TEST_FILES,
	NODE_STORE_CONTRACT_TEST_FILES,
	UNIT_TEST_PATTERN,
} from './vitest.config.constants'

import { playwright } from '@vitest/browser-playwright'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'

import type { TierOnlyTestFile } from './vitest.config.types'
import type { BrowserConfigOptions } from 'vitest/node'

const root = fileURLToPath(new URL('./', import.meta.url))

/** Every include pattern names at least one file: a moved test file must not drop out of its project unseen. */
function assertEachIncludeMatches(params: {
	project: string
	include: readonly string[]
}): string[] {
	const { project, include } = params
	const unmatched = include.filter(function matchesNoFile(pattern) {
		return globSync(pattern, { cwd: root }).length === 0
	})
	if (unmatched.length > 0) {
		throw new Error(
			`vitest project "${project}" includes files that do not exist: ${unmatched.join(', ')}`,
		)
	}
	return [...include]
}

/** The paths of a tier-only list, each checked to name a file. */
function pathsOf(params: { project: string; files: readonly TierOnlyTestFile[] }): string[] {
	const { project, files } = params
	return assertEachIncludeMatches({ project, include: files.map((file) => file.path) })
}

function createBrowser(
	instances: BrowserConfigOptions['instances'] = [{ browser: 'chromium' }],
): BrowserConfigOptions {
	return {
		provider: playwright(),
		enabled: true,
		headless: true,
		instances,
		screenshotFailures: false,
	}
}

// Perf benches measure browser storage on disk: a default (off-the-record) context keeps OPFS and IndexedDB in
// memory, under a small quota. One profile directory per browser, git-ignored under .tmp; benches remove what they create.
// Playwright's patched Firefox does not start on every macOS: the bench's Firefox run uses stock Firefox over BiDi.
function benchProfile(browser: string): string {
	return `${process.env.BENCH_PROFILE_DIR ?? `${root}.tmp/bench-profile`}-${browser}`
}

function benchInstances(): BrowserConfigOptions['instances'] {
	if (process.env.BENCH_FIREFOX_EXECUTABLE) {
		return [
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
	}
	return [
		{ browser: 'chromium', provider: playwright({ persistentContext: benchProfile('chromium') }) },
	]
}

// The browser tests run on Chromium; UNIT_FIREFOX_EXECUTABLE runs them once on stock Firefox over BiDi instead (the
// engine's worker legs, best effort: Playwright's own Firefox build does not start on every macOS).
function browserTestInstances(): BrowserConfigOptions['instances'] {
	if (!process.env.UNIT_FIREFOX_EXECUTABLE) return [{ browser: 'chromium' }]
	return [
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
}

const browserOnlyPaths = pathsOf({ project: 'browser', files: BROWSER_ONLY_TEST_FILES })
const nodeOnlyPaths = pathsOf({ project: 'node', files: NODE_ONLY_TEST_FILES })
const nodeStoreContractPaths = assertEachIncludeMatches({
	project: 'node-indexeddb',
	include: NODE_STORE_CONTRACT_TEST_FILES,
})

/**
 * A browser test project, sqlite-wasm left to resolve its own wasm. Its `groupOrder` is its own: a bare `vitest run`
 * runs the browser projects one after the other, never two Chromiums at once.
 */
function browserTestProject(params: {
	name: string
	include: string[]
	exclude: string[]
	groupOrder: number
}) {
	const { name, include, exclude, groupOrder } = params
	return {
		resolve: viteConfig.resolve,
		// sqlite-wasm resolves its wasm itself: a pre-bundled copy loses the file next to it
		optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
		plugins: [],
		test: {
			name,
			sequence: { groupOrder },
			browser: createBrowser(browserTestInstances()),
			include,
			exclude: [...configDefaults.exclude, BENCH_TEST_PATTERN, ...exclude],
			root,
		},
	}
}

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			watch: false,
			testTimeout: 5_000,
			projects: [
				{
					// every test file but the browser-only ones, in node on the in-memory store: the test helpers'
					// default, set by the setup file. The files share their modules (and the realm): the same
					// verdicts as isolated files, whatever their order, in a third of the time.
					resolve: viteConfig.resolve,
					plugins: [],
					test: {
						name: 'node',
						environment: 'node',
						isolate: false,
						include: [UNIT_TEST_PATTERN],
						exclude: [
							...configDefaults.exclude,
							BENCH_TEST_PATTERN,
							...browserOnlyPaths,
							...nodeStoreContractPaths,
						],
						setupFiles: ['src/test/in-memory-storage.setup.ts'],
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
						name: 'node-indexeddb',
						environment: 'node',
						isolate: false,
						include: nodeStoreContractPaths,
						setupFiles: ['src/store/contract/store-contract.node.setup.ts'],
						root,
					},
				},
				// the browser-only test files, the store contract on IndexedDB and SQLite among them
				browserTestProject({
					name: 'browser',
					include: browserOnlyPaths,
					exclude: [],
					groupOrder: BROWSER_GROUP_ORDER.browser,
				}),
				// the whole suite in the browser, on the local store: the run before a branch merges
				browserTestProject({
					name: 'browser-all',
					groupOrder: BROWSER_GROUP_ORDER.browserAll,
					include: [UNIT_TEST_PATTERN],
					exclude: nodeOnlyPaths,
				}),
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
						sequence: { groupOrder: BROWSER_GROUP_ORDER.perf },
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
