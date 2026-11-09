import { globSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { FULL_TABLE_VARIABLE } from './src/store/contract/store-contract.constants'
import { benchCommands } from './src/store/sqlite/bench/bench-commands'
import viteConfig from './vite.config'
import {
	BENCH_TEST_PATTERN,
	BROWSER_GROUP_ORDER,
	BROWSER_ONLY_TEST_FILES,
	DOCUMENT_SUITES_PATTERN,
	NODE_BENCH_TEST_FILES,
	NODE_ONLY_TEST_FILES,
	NODE_STORE_CONTRACT_TEST_FILES,
	SCRIPT_TEST_PATTERN,
	TEST_TAGS,
	UNIT_TEST_PATTERN,
	WORKER_FILE_PATTERN,
} from './vitest.config.constants'

import { playwright } from '@vitest/browser-playwright'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'

import type { TierOnlyTestFile } from './vitest.config.types'
import type { Plugin } from 'vite'
import type { BrowserConfigOptions } from 'vitest/node'

const root = fileURLToPath(new URL('./', import.meta.url))

/**
 * What a project running the store contract's legs gives its tests: the full-table switch from the environment (a
 * release sets it), readable in node and in the browser alike.
 */
const contractEnvironment = { [FULL_TABLE_VARIABLE]: process.env[FULL_TABLE_VARIABLE] ?? '' }

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
const nodeBenchPaths = pathsOf({ project: 'perf-node', files: NODE_BENCH_TEST_FILES })
const nodeStoreContractPaths = assertEachIncludeMatches({
	project: 'node-indexeddb',
	include: NODE_STORE_CONTRACT_TEST_FILES,
})

/**
 * A worker file started from its address (`new URL(file, import.meta.url)`) given what the browser runner gives one
 * it knows from Vite's `?worker`: the runner wraps every dynamic import in a member of its page's global, which a
 * worker does not have.
 */
function dynamicImportInWorkerFiles(): Plugin {
	return {
		name: 'core-test:dynamic-import-in-worker-files',
		transform(code, id) {
			if (!WORKER_FILE_PATTERN.test(id)) return
			return {
				code: `globalThis.__vitest_browser_runner__ ??= { wrapDynamicImport: (load) => load() };\n${code}`,
				map: null,
			}
		},
	}
}

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
		plugins: [dynamicImportInWorkerFiles()],
		test: {
			name,
			sequence: { groupOrder },
			tags: [...TEST_TAGS],
			env: contractEnvironment,
			// the same value on a second channel: a leg checks its realm sees what the config set
			provide: contractEnvironment,
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
						include: [UNIT_TEST_PATTERN, SCRIPT_TEST_PATTERN],
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
					// the Document and Query suites again, in node on the SQLite engine (run in process): the test
					// helpers' default set by the setup file, as a dialecte's runner chooses it
					resolve: viteConfig.resolve,
					plugins: [],
					test: {
						name: 'node-sqlite',
						environment: 'node',
						isolate: false,
						include: [DOCUMENT_SUITES_PATTERN],
						exclude: [...configDefaults.exclude, BENCH_TEST_PATTERN, ...browserOnlyPaths],
						setupFiles: ['src/test/sqlite-storage.setup.ts'],
						root,
					},
				},
				{
					// the Document and Query suites again, in node on IndexedDB through fake-indexeddb (the local store):
					// the test helpers' default set by the setup file, as a runner on IndexedDB chooses it
					resolve: viteConfig.resolve,
					plugins: [],
					test: {
						name: 'node-indexeddb-documents',
						environment: 'node',
						isolate: false,
						include: [DOCUMENT_SUITES_PATTERN],
						exclude: [...configDefaults.exclude, BENCH_TEST_PATTERN, ...browserOnlyPaths],
						setupFiles: ['src/test/indexeddb-storage.setup.ts'],
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
						tags: [...TEST_TAGS],
						env: contractEnvironment,
						provide: contractEnvironment,
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
						include: [BENCH_TEST_PATTERN],
						exclude: [...configDefaults.exclude, ...nodeBenchPaths],
						root,
					},
				},
				{
					// the benches that measure in node (`npm run test:perf:node`), one file at a time
					resolve: viteConfig.resolve,
					plugins: [],
					test: {
						name: 'perf-node',
						environment: 'node',
						testTimeout: 180_000,
						fileParallelism: false,
						include: nodeBenchPaths,
						root,
					},
				},
			],
		},
	}),
)
