import type { TierOnlyTestFile } from './vitest.config.types'

/** The files core's browser tests start as workers, with or without a query. */
export const WORKER_FILE_PATTERN = /\.worker\.ts(?:\?|$)/

/**
 * The test files that need a browser: the `browser` project runs them, the `node` project leaves them
 * out. Every other test file runs in node, on the in-memory store.
 */
export const BROWSER_ONLY_TEST_FILES: readonly TierOnlyTestFile[] = [
	{
		path: 'src/store/contract/store-contract.test.ts',
		why: 'the store contract on IndexedDB and on SQLite over OPFS (node runs it on the in-memory store and fake-indexeddb)',
	},
	{ path: 'src/store/local/dexie-store.test.ts', why: 'the IndexedDB store' },
	{
		path: 'src/store/local/dexie-store.instrumentation.test.ts',
		why: 'the IndexedDB store, its reads counted',
	},
	{
		path: 'src/project/import.indexeddb.test.ts',
		why: 'a refused import leaves no row and no table in IndexedDB',
	},
	{
		path: 'src/project/project-lifecycle.indexeddb.test.ts',
		why: 'a project its store refused to open, destroyed on IndexedDB: the database deleted, never opened',
	},
	{
		path: 'src/project/open-sweep.indexeddb.test.ts',
		why: 'open() on IndexedDB: a leftover table removed, a row from before `status` read',
	},
	{
		path: 'src/dialecte/create-project-factory.indexeddb.test.ts',
		why: 'the factory default store: a database in IndexedDB',
	},
	{
		path: 'src/test/create-test-dialecte.indexeddb.test.ts',
		why: 'a local test project: its IndexedDB database removed on destroy and when its test ends',
	},
	{
		path: 'src/test/create-test-helpers.indexeddb.test.ts',
		why: 'the local store as a case of the storage precedence: a database in IndexedDB',
	},
	{
		path: 'src/store/sqlite/runtime/serve-sqlite-engine.test.ts',
		why: 'the SQLite engine served from a worker, its files in OPFS',
	},
	{
		path: 'src/store/sqlite/runtime/engine-control-loop.test.ts',
		why: 'engine workers: the control loop of the worker file answering messages posted in its first turn',
	},
	{
		path: 'src/store/sqlite/runtime/install-pool.test.ts',
		why: "the engine's Web Lock, which only a browser has",
	},
	{
		path: 'src/store/sqlite/runtime/engine-liveness.test.ts',
		why: 'engine workers and the liveness signals between tabs',
	},
	{
		path: 'src/store/sqlite/served/client/worker-connector.test.ts',
		why: 'starts the engine in a dedicated or shared worker',
	},
	{
		path: 'src/store/sqlite/served/client/hub-connector.test.ts',
		why: "a store reaching its project's engine through the origin's SharedWorker hub",
	},
	{
		path: 'src/store/sqlite/served/hub/hub-client.test.ts',
		why: "a page joining the origin's SharedWorker hub: its realm lock, frozen and restored pages, child ports",
	},
	{
		path: 'src/store/sqlite/served/hub/hub.browser.test.ts',
		why: "realms of the page in iframes of their own, on the origin's SharedWorker hub",
	},
	{
		path: 'src/store/sqlite/served/hub/realm-host.test.ts',
		why: 'a page hosting engine workers for the hub, their locks let go',
	},
	{
		path: 'src/store/sqlite/served/client/engine-client.page-lifecycle.test.ts',
		why: "the page's `resume` event (a frozen tab coming back)",
	},
	{
		path: 'src/store/sqlite/adapter/sqlite-connector.test.ts',
		why: 'a project on `sqlite` storage: its engine worker, the origin’s hub and private file system',
	},
	{
		path: 'src/store/sqlite/adapter/sqlite-connector.no-hub.test.ts',
		why: 'a page with workers, no SharedWorker and its private file system refused (a browser realm, stubbed)',
	},
	{
		path: 'src/store/sqlite/adapter/sqlite-connector.offer.test.ts',
		why: 'what a browser realm offers the hub, its private file system handed or refused',
	},
	{
		path: 'src/store/sqlite/list-projects.opfs.test.ts',
		why: 'projects listed from the origin’s private file system, destroyed by name',
	},
	{
		path: 'src/store/sqlite/load-sqlite.test.ts',
		why: 'fetches the SQLite wasm file the page serves',
	},
	{
		path: 'src/store/json-values.page.test.ts',
		why: "`document.all` and the values of a frame's realm",
	},
	{
		path: 'src/project/io/export-document.test.ts',
		why: "the save dialog, the download link and `xmlDocument: true` (the page's DOMParser)",
	},
	{ path: 'src/project/io/export-blob.test.ts', why: 'the save dialog and the download link' },
	{ path: 'src/utils/save-to-disk.test.ts', why: 'the save dialog and the download link' },
	{
		path: 'src/test/xml/xml-parity.page.test.ts',
		why: "the test entry's XML seam compared with the page's DOMParser and document.evaluate",
	},
	{
		path: 'src/xml/dom/xml-document-from-file.test.ts',
		why: "parses a file with the page's DOMParser",
	},
]

/** The test files that read the package from disk, start node itself or assert what Node lacks: never in a browser. */
export const NODE_ONLY_TEST_FILES: readonly TierOnlyTestFile[] = [
	{
		path: 'src/store/sqlite/packaging/engine-packaging.test.ts',
		why: 'builds the engine and reads the build output from disk',
	},
	{
		path: 'src/store/sqlite/sqlite-unavailable.test.ts',
		why: 'asserts what SQLite storage answers where no worker and no private file system exist; a browser has both',
	},
	{
		path: 'src/store/storage-boundary.test.ts',
		why: 'reads the sources from disk: what picks a store names nothing of SQLite',
	},
	{
		path: 'src/store/shared-shapes.test.ts',
		why: 'compiles what copies of the library share from disk and reads its recorded shapes',
	},
	{
		path: 'src/test/test-entry-environment.test.ts',
		why: 'reads the sources of the test entry from disk',
	},
	{
		path: 'src/test/test-entry-bundle.test.ts',
		why: 'builds the test entry with vite and reads the output',
	},
	{
		path: 'src/test/test-entry-types.test.ts',
		why: 'compiles the test entry with the TypeScript API and reads its sources from disk',
	},
	{
		path: 'src/test/dependencies.test.ts',
		why: 'reads package.json and the sources from disk: no retired XML module',
	},
	{
		path: 'src/test/assert-valid-xml/assert-valid-xml-imports.test.ts',
		why: 'reads the sources of the shape check from disk',
	},
	{
		path: 'src/test/xml/engine-import.test.ts',
		why: 'reads the sources from disk: only the XML seam imports the engine',
	},
	{
		path: 'src/test/xml/refusal-output.test.ts',
		why: 'starts node to read what a refused XPath expression writes',
	},
]

/**
 * The store contract, the project's store switch and the IndexedDB-specific files in node: on the in-memory store
 * and on IndexedDB through fake-indexeddb, given to node by their own setup file.
 */
export const NODE_STORE_CONTRACT_TEST_FILES: readonly string[] = [
	'src/store/contract/store-contract.test.ts',
	'src/project/store-switch.test.ts',
	// the IndexedDB-specific files: at every step on fake-indexeddb, once per lot in the browser on IndexedDB
	'src/store/local/dexie-store.test.ts',
	'src/store/local/dexie-store.instrumentation.test.ts',
	'src/project/import.indexeddb.test.ts',
	'src/project/open-sweep.indexeddb.test.ts',
	'src/dialecte/create-project-factory.indexeddb.test.ts',
	'src/test/create-test-dialecte.indexeddb.test.ts',
	'src/test/create-test-helpers.indexeddb.test.ts',
]

/** The Document and Query suites: run again on the SQLite engine (`node-sqlite`), store is a switch. */
export const DOCUMENT_SUITES_PATTERN = 'src/document/**/*.test.ts'

/** Every unit test file; benches run in their own project. */
export const UNIT_TEST_PATTERN = 'src/**/*.test.{js,ts,jsx,tsx}'

export const BENCH_TEST_PATTERN = 'src/**/*.bench.test.{js,ts}'

/** The benches that measure in node, not in a browser: the `perf-node` project runs them, `perf` leaves them out. */
export const NODE_BENCH_TEST_FILES: readonly TierOnlyTestFile[] = [
	{
		path: 'src/test/xml/xml-assert.bench.test.ts',
		why: 'the XML assertions on a generated 5 MB file, in node: the budget of a node test run',
	},
]

/**
 * The run order of the browser projects after the node ones (group 0): each its own group, so a run naming
 * several never starts their Chromiums at once.
 */
export const BROWSER_GROUP_ORDER = { browser: 1, browserAll: 2, perf: 3 } as const
