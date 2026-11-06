import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	ENGINE_CHUNK,
	ENGINE_ONLY_MARKER,
	PACKAGING_CASE_TIMEOUT_MS,
} from './engine-packaging.constants'

import { build, createServer, optimizeDeps, resolveConfig } from 'vite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: PACKAGING_CASE_TIMEOUT_MS })

/** The package's root: core's own build configs are read from there. */
const CORE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
/** Everything a run builds, removed after it. */
const WORK = path.join(CORE_ROOT, '.tmp', `packaging-${process.pid}`)
/**
 * core as a consumer installs it: its package.json beside its build in a `node_modules` above every app of the run,
 * so they resolve `@dialecte/core` through its `exports` and its `sideEffects` as a bundler does (its own
 * dependencies found further up, in core's install).
 */
const CORE_PACKAGE = path.join(WORK, 'node_modules', '@dialecte', 'core')
const CORE_DIST = path.join(CORE_PACKAGE, 'dist')
const DIALECTE = path.join(WORK, 'dialecte')
/** A consumer on SQLite storage: one engine worker file for its dialectes, and the page that registers it. */
const APP = path.join(WORK, 'app')
/** A consumer on SQLite storage that names no engine worker: it imports `@dialecte/core/sqlite` for what it registers. */
const REGISTER_ONLY_APP = path.join(WORK, 'app-register-only')
/** A consumer that never imports `@dialecte/core/sqlite`. */
const MAIN_ONLY_APP = path.join(WORK, 'app-main-only')

/** A sub-path of core's package.json `exports`: the file a bundler loads, and its types. */
type PackageExport = { default: string; types: string }

/** core's package.json, as the run installs it. */
const PACKAGE_JSON = path.join(CORE_ROOT, 'package.json')

/**
 * A dialecte package, as a dialecte ships one: its declarations, core kept external, no worker: the app that opens its
 * projects bundles the one engine worker for all the dialectes it uses.
 */
const DIALECTE_FILES: Record<string, string> = {
	'dialecte.ts': [
		"import { defineDialecte } from '@dialecte/core'",
		"export const DIALECTE = defineDialecte({ id: 'fixture', version: '0.0.0', configs: { default: {} as never }, defaultConfigKey: 'default' })",
		"export const OTHER_DIALECTE = defineDialecte({ id: 'fixture-other', version: '0.0.0', configs: { default: {} as never }, defaultConfigKey: 'default' })",
	].join('\n'),
	'index.ts': "export { DIALECTE, OTHER_DIALECTE } from './dialecte'",
}

/** Where an app finds the dialecte package's build. */
const DIALECTE_BUILD = path.join(DIALECTE, 'dist', 'index.js')

/**
 * The app's one engine worker file: every dialecte it uses, served from `@dialecte/core/sqlite`, built by the app's
 * bundler as it builds any worker - no setting.
 */
const ENGINE_WORKER_SOURCE = [
	"import { serveSqliteEngine } from '@dialecte/core/sqlite'",
	`import { DIALECTE, OTHER_DIALECTE } from '${DIALECTE_BUILD}'`,
	'serveSqliteEngine({ dialectes: [DIALECTE, OTHER_DIALECTE] })',
].join('\n')

/** The app's page: the worker file's URL, registered once with the dialectes it serves. */
const APP_PAGE_SOURCE = [
	"import engineUrl from './engine.worker.js?worker&url'",
	"import { registerSqliteEngine } from '@dialecte/core/sqlite'",
	"import { createProjectFactory } from '@dialecte/core'",
	`import { DIALECTE, OTHER_DIALECTE } from '${DIALECTE_BUILD}'`,
	'registerSqliteEngine({ url: engineUrl, dialectes: [DIALECTE, OTHER_DIALECTE] })',
	'console.log(createProjectFactory({ dialecte: DIALECTE }))',
].join('\n')

/** A page that imports `@dialecte/core/sqlite` for what it registers and names no engine worker. */
const REGISTER_ONLY_PAGE_SOURCE = [
	// the import the docs give: nothing named, the entry kept for what it registers
	"import '@dialecte/core/sqlite'",
	"import { createProjectFactory } from '@dialecte/core'",
	'console.log(createProjectFactory)',
].join('\n')

/** Every file under `directory`, with its path relative to it. */
async function filesUnder(params: { directory: string }): Promise<string[]> {
	const entries = await readdir(params.directory, { recursive: true, withFileTypes: true })
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(params.directory, path.join(entry.parentPath, entry.name)))
}

async function textOf(params: { file: string }): Promise<string> {
	return readFile(params.file, 'utf8')
}

/** The hub's worker chunk, as core's build names it. */
const HUB_CHUNK = /^assets\/hub\.worker-[\w-]+\.js$/

function isHubChunk(file: string): boolean {
	return HUB_CHUNK.test(file)
}

/** A worker a consumer's build emits for the hub (named after core's chunk). */
function isHubWorker(file: string): boolean {
	return file.includes('hub.worker')
}

/** A wasm file in a build. */
function isWasmFile(file: string): boolean {
	return file.endsWith('.wasm')
}

/** A dialecte's engine worker in a consumer's build (the hub is a worker too). */
function isEngineWorker(file: string): boolean {
	return file.includes('.worker') && !isHubWorker(file)
}

/** A script of core's main side: not the hub's chunk. */
function isCoreMainScript(file: string): boolean {
	return file.endsWith('.js') && !isHubChunk(file)
}

/** A script of a consumer's main side: no worker. */
function isAppMainScript(file: string): boolean {
	return file.endsWith('.js') && !file.includes('.worker')
}

/** The first of `files` (relative to `directory`) whose text holds `fragment`. */
async function fileHolding(params: {
	directory: string
	files: string[]
	fragment: string
}): Promise<string | undefined> {
	for (const file of params.files) {
		const text = await textOf({ file: path.join(params.directory, file) })
		if (text.includes(params.fragment)) return file
	}
	return undefined
}

/** What must never be in an engine chunk: an inlined wasm, the async proxy inlined, sqlite-wasm's worker1. */
const NO_ASSET_OF_SQLITE = [
	'data:application/wasm',
	'data:text/javascript',
	'sqlite3-worker1',
	'new URL("sqlite3.wasm"',
]

/** What libxml2-wasm leaves in a chunk that bundles it. */
const LIBXML2_MARKERS = ['libxml2', 'xmlReadString', 'XmlParseError']

/**
 * An import of sqlite-wasm's module, static or dynamic (the main build keeps it external: bundled, it would hold
 * `sqlite3ApiBootstrap` instead); an asset of it imported by URL (`?url`) is resolved by the build.
 */
const SQLITE_MODULE_IMPORT =
	/(?:from|import)\s*\(?\s*["']@sqlite\.org\/sqlite-wasm(?:\/[^"'?]*)?["']/

/** A static import of a chunk (`from "./x.js"`, `import "./x.js"`), from the importer's folder. */
const STATIC_CHUNK_IMPORT = /(?:from|import)\s*["'](\.{1,2}\/[^"']+\.js)["']/g
/** A static or a dynamic (`import("../x.js")`) import of a chunk. */
const ANY_CHUNK_IMPORT = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g

/**
 * The entry's chunk and every chunk it imports in core's build: statically only (what loads with the entry), or
 * through `import()` too (what the entry may load later), the `except` chunks left out with what only they reach.
 */
async function chunksReachedFrom(params: {
	entry: string
	staticOnly?: boolean
	/** Chunks not entered (the one the entry loads on demand and that this reading does not follow). */
	except?: string[]
}): Promise<Map<string, string>> {
	const { except = [] } = params
	const imports = params.staticOnly ? STATIC_CHUNK_IMPORT : ANY_CHUNK_IMPORT
	const reached = new Map<string, string>()
	const pending = [params.entry]
	while (pending.length > 0) {
		const file = pending.pop()!
		if (reached.has(file) || except.includes(file)) continue
		const text = await textOf({ file: path.join(CORE_DIST, file) })
		reached.set(file, text)
		for (const match of text.matchAll(imports)) {
			pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]!)))
		}
	}
	return reached
}

/** What core's main side writes for the one wasm file: a URL a consumer's bundler resolves. */
const WASM_URL_EXPRESSION = 'new URL("sqlite3.wasm", import.meta.url)'

/** Text only the SQLite connector holds (its refusal where no engine can run): where its code went in a build. */
const SQLITE_CONNECTOR_MARKER = 'cannot be stored with SQLite here'

/** The chunks of core's build holding `fragment`. */
function chunksHolding(params: { chunks: Map<string, string>; fragment: string }): string[] {
	const { chunks, fragment } = params
	return [...chunks]
		.filter(function holdsFragment([, text]) {
			return text.includes(fragment)
		})
		.map(function fileOf([file]) {
			return file
		})
}

/** Every file of `files` (relative to `directory`) whose text holds `fragment`. */
async function filesHolding(params: {
	directory: string
	files: string[]
	fragment: string
}): Promise<string[]> {
	const holding: string[] = []
	for (const file of params.files) {
		const text = await textOf({ file: path.join(params.directory, file) })
		if (text.includes(params.fragment)) holding.push(file)
	}
	return holding
}

/** The documentation comment above a function core's declarations export, wherever the entry's declarations place it. */
async function docblockOf(params: { name: string }): Promise<string> {
	const declared = new RegExp(
		`/\\*\\*(?:(?!\\*/)[\\s\\S])*\\*/\\s*export declare function ${params.name}\\b`,
	)
	const declarations = (await filesUnder({ directory: CORE_DIST })).filter((file) =>
		file.endsWith('.d.ts'),
	)
	for (const file of declarations) {
		const text = await textOf({ file: path.join(CORE_DIST, file) })
		const found = declared.exec(text)
		if (found) return found[0]
	}
	return ''
}

beforeAll(async () => {
	await rm(WORK, { recursive: true, force: true })
	// a package of its own: the run is inside core's folder, whose package.json would otherwise resolve
	// `@dialecte/core` to core's own dist (a package's self-reference wins over node_modules)
	await mkdir(WORK, { recursive: true })
	await writeFile(
		path.join(WORK, 'package.json'),
		JSON.stringify({ name: 'packaging-run', private: true, type: 'module' }),
	)
	// core's two library builds, as `npm run build` makes them, into one folder
	await build({
		configFile: path.join(CORE_ROOT, 'vite.config.ts'),
		root: CORE_ROOT,
		logLevel: 'silent',
		build: { outDir: CORE_DIST },
	})
	await build({
		configFile: path.join(CORE_ROOT, 'vite.engine.config.ts'),
		root: CORE_ROOT,
		logLevel: 'silent',
		build: { outDir: CORE_DIST },
	})
	const packageJson = await readFile(PACKAGE_JSON, 'utf8')
	await writeFile(path.join(CORE_PACKAGE, 'package.json'), packageJson)
	await mkdir(DIALECTE, { recursive: true })
	for (const [name, source] of Object.entries(DIALECTE_FILES)) {
		await writeFile(path.join(DIALECTE, name), source)
	}
	await build({
		configFile: false,
		root: DIALECTE,
		base: './',
		logLevel: 'silent',
		build: {
			outDir: path.join(DIALECTE, 'dist'),
			lib: { entry: { index: path.join(DIALECTE, 'index.ts') }, formats: ['es'] },
			rollupOptions: { external: [/^@dialecte\/core/] },
		},
	})
	// the app bundles the one engine worker itself, with no bundler setting of its own
	await mkdir(APP, { recursive: true })
	await writeFile(path.join(APP, 'engine.worker.js'), ENGINE_WORKER_SOURCE)
	await writeFile(path.join(APP, 'main.js'), APP_PAGE_SOURCE)
	await writeFile(path.join(APP, 'index.html'), '<script type="module" src="./main.js"></script>')
	await build({
		configFile: false,
		root: APP,
		logLevel: 'silent',
		build: { outDir: path.join(APP, 'dist') },
	})
	await mkdir(REGISTER_ONLY_APP, { recursive: true })
	await writeFile(path.join(REGISTER_ONLY_APP, 'main.js'), REGISTER_ONLY_PAGE_SOURCE)
	await writeFile(
		path.join(REGISTER_ONLY_APP, 'index.html'),
		'<script type="module" src="./main.js"></script>',
	)
	await build({
		configFile: false,
		root: REGISTER_ONLY_APP,
		logLevel: 'silent',
		build: { outDir: path.join(REGISTER_ONLY_APP, 'dist') },
	})
	await mkdir(MAIN_ONLY_APP, { recursive: true })
	await writeFile(
		path.join(MAIN_ONLY_APP, 'main.js'),
		[
			"import { createProjectFactory, Project } from '@dialecte/core'",
			'console.log(createProjectFactory, Project)',
		].join('\n'),
	)
	await writeFile(
		path.join(MAIN_ONLY_APP, 'index.html'),
		'<script type="module" src="./main.js"></script>',
	)
	await build({
		configFile: false,
		root: MAIN_ONLY_APP,
		logLevel: 'silent',
		build: { outDir: path.join(MAIN_ONLY_APP, 'dist') },
	})
}, 120_000)

afterAll(async () => {
	// a dev server's dependency optimizer may still be writing its cache as the folder goes
	await rm(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('the engine as a dialecte and a consumer bundle it', () => {
	it('core’s package.json exports → `.` and `./sqlite` each with its file and types in the installed package; `./engine` and `./sqlite/engine` are gone', async () => {
		const fileText = await textOf({ file: PACKAGE_JSON })
		const { exports } = JSON.parse(fileText) as {
			exports: Record<string, PackageExport | string>
		}
		const installed = await filesUnder({ directory: CORE_PACKAGE })
		for (const subPath of ['.', './sqlite']) {
			const entry = exports[subPath] as PackageExport
			for (const field of ['default', 'types'] as const) {
				expect(installed, `${subPath} ${field}`).toContain(path.normalize(entry[field]))
			}
		}
		expect(Object.keys(exports)).not.toContain('./engine')
		expect(Object.keys(exports)).not.toContain('./sqlite/engine')
	})

	it('core’s sqlite entry types → serveSqliteEngine and registerSqliteEngine both declared, each documented with its @intent', async () => {
		const entry = await textOf({ file: path.join(CORE_DIST, 'sqlite.d.ts') })
		for (const name of ['serveSqliteEngine', 'registerSqliteEngine']) {
			// declared by the entry or re-exported by it; the declaration a consumer's editor shows holds the intent
			expect(entry, name).toMatch(new RegExp(`\\b${name}\\b`))
			const docblock = await docblockOf({ name })
			expect(docblock, name).toContain('@intent')
		}
	})

	it('core’s two builds → the engine’s chunk beside the entries, named in no export, no asset of sqlite-wasm in it', async () => {
		const files = await filesUnder({ directory: CORE_DIST })
		expect(files).toEqual(expect.arrayContaining(['index.js', 'sqlite.js', ENGINE_CHUNK]))
		expect(files).not.toContain('engine.js')
		expect(files.filter((file) => file.includes('worker1'))).toEqual([])
		const engine = await textOf({ file: path.join(CORE_DIST, ENGINE_CHUNK) })
		for (const forbidden of NO_ASSET_OF_SQLITE) expect(engine, forbidden).not.toContain(forbidden)
	})

	it('core’s main and SQLite entries → no chunk they reach imports sqlite-wasm or holds it: an engine in the page is not on the main side', async () => {
		// the SQLite entry loads the engine's chunk on demand: that chunk is the engine, which holds sqlite-wasm by design
		const engineIsLoadedOnDemand = { 'index.js': [], 'sqlite.js': [ENGINE_CHUNK] }
		for (const [entry, except] of Object.entries(engineIsLoadedOnDemand)) {
			const chunks = await chunksReachedFrom({ entry, except })
			const reachingSqlite = [...chunks]
				.filter(function importsSqliteWasm([, text]) {
					return SQLITE_MODULE_IMPORT.test(text) || text.includes('sqlite3ApiBootstrap')
				})
				.map(function fileOf([file]) {
					return file
				})
			expect(reachingSqlite, entry).toEqual([])
		}
	})

	it('core’s main entry → no chunk it reaches holds libxml2, which only the test entry bundles', async () => {
		const mainChunks = await chunksReachedFrom({ entry: 'index.js' })
		expect(mainChunks.has('index.js')).toBe(true)
		const holdingLibxml2 = [...mainChunks]
			.filter(([, text]) => LIBXML2_MARKERS.some((marker) => text.includes(marker)))
			.map(([file]) => file)
		expect(holdingLibxml2).toEqual([])
		const testEntry = await textOf({ file: path.join(CORE_DIST, 'test.js') })
		expect(LIBXML2_MARKERS.some((marker) => testEntry.includes(marker))).toBe(true)
	})

	it('core’s main entry → neither the SQLite connector nor the wasm’s URL in any chunk it reaches, through import() or not', async () => {
		const distributedFiles = await filesUnder({ directory: CORE_DIST })
		expect(distributedFiles).toContain('sqlite3.wasm')
		const loadedWithEntry = await chunksReachedFrom({ entry: 'index.js', staticOnly: true })
		// the main entry loads chunks of its own: a reading that found none would prove nothing
		expect(loadedWithEntry.size).toBeGreaterThan(1)
		const reachable = await chunksReachedFrom({ entry: 'index.js' })
		for (const fragment of [WASM_URL_EXPRESSION, SQLITE_CONNECTOR_MARKER, 'new SharedWorker(']) {
			expect(chunksHolding({ chunks: reachable, fragment }), fragment).toEqual([])
		}
	})

	it('core’s SQLite entry → the connector and the wasm’s URL loaded with it, each in one chunk', async () => {
		const loadedWithEntry = await chunksReachedFrom({ entry: 'sqlite.js', staticOnly: true })
		for (const fragment of [SQLITE_CONNECTOR_MARKER, WASM_URL_EXPRESSION]) {
			expect(chunksHolding({ chunks: loadedWithEntry, fragment }), fragment).toHaveLength(1)
		}
	})

	it('core’s SQLite entry → the engine’s chunk reached by import() only, never by a static import: it loads when an engine worker asks for it, not with the entry', async () => {
		const loadedWithEntry = await chunksReachedFrom({ entry: 'sqlite.js', staticOnly: true })
		expect([...loadedWithEntry.keys()]).not.toContain(ENGINE_CHUNK)
		const reachable = await chunksReachedFrom({ entry: 'sqlite.js' })
		expect([...reachable.keys()]).toContain(ENGINE_CHUNK)
		const entry = await textOf({ file: path.join(CORE_DIST, 'sqlite.js') })
		expect(entry).toMatch(/import\(\s*["']\.\/sqlite-engine\.js["']\s*\)/)
		const reachableFromMain = await chunksReachedFrom({ entry: 'index.js' })
		expect(reachableFromMain.has(ENGINE_CHUNK)).toBe(false)
	})

	it('a consumer importing only core’s main entry → no wasm, no hub worker, no SQLite code emitted', async () => {
		const directory = path.join(MAIN_ONLY_APP, 'dist')
		const files = await filesUnder({ directory })
		// the app's own script: a build that emitted nothing would prove nothing
		expect(files.filter(isAppMainScript).length).toBeGreaterThan(0)
		expect(files.filter(isWasmFile)).toEqual([])
		expect(files.filter(isHubWorker)).toEqual([])
		for (const fragment of ['sqlite3', SQLITE_CONNECTOR_MARKER, 'new SharedWorker(']) {
			const holding = await fileHolding({ directory, files, fragment })
			expect(holding, fragment).toBeUndefined()
		}
	})

	it('a dialecte package’s build, two declarations → no worker file, and nothing of SQLite in any of its files', async () => {
		const directory = path.join(DIALECTE, 'dist')
		const files = await filesUnder({ directory })
		// the package’s own script: a build that emitted nothing would prove nothing
		expect(files.filter((file) => file.endsWith('.js')).length).toBeGreaterThan(0)
		expect(files.filter((file) => file.includes('.worker'))).toEqual([])
		for (const fragment of [
			'sqlite3',
			SQLITE_CONNECTOR_MARKER,
			'new SharedWorker(',
			'@dialecte/core/sqlite',
		]) {
			const holding = await fileHolding({ directory, files, fragment })
			expect(holding, fragment).toBeUndefined()
		}
	})

	it('an app’s build, one engine worker file for two dialectes and no bundler setting → exactly one engine worker, one content-hashed wasm for it, the hub’s worker once, sqlite-wasm’s code in the worker file only', async () => {
		const directory = path.join(APP, 'dist')
		const files = await filesUnder({ directory })
		const workers = files.filter(isEngineWorker)
		expect(workers).toHaveLength(1)
		expect(files.filter(isWasmFile)).toEqual([
			expect.stringMatching(/^assets\/sqlite3-[\w-]+\.wasm$/),
		])
		expect(files.filter(isHubWorker)).toHaveLength(1)
		const holdingBootstrap = await filesHolding({
			directory,
			files,
			fragment: 'sqlite3ApiBootstrap',
		})
		expect(holdingBootstrap).toEqual(workers)
		// the page’s own chunks reach the wasm by its URL, to hand it to the engines
		const [wasm] = files.filter(isWasmFile)
		const holdingWasmUrl = await filesHolding({
			directory,
			files: files.filter(isAppMainScript),
			fragment: path.basename(wasm!),
		})
		expect(holdingWasmUrl.length).toBeGreaterThan(0)
	})

	it('an app’s build → its page chunks hold no sqlite-wasm code and no engine code: the engine is in its worker file, which the page reaches by URL only', async () => {
		const directory = path.join(APP, 'dist')
		const files = await filesUnder({ directory })
		const [worker] = files.filter(isEngineWorker)
		// the markers mean something only if the worker file holds them
		const workerText = await textOf({ file: path.join(directory, worker!) })
		expect(workerText).toContain('sqlite3ApiBootstrap')
		expect(workerText).toContain(ENGINE_ONLY_MARKER)
		// the engine is bundled into the app's worker with no asset of sqlite-wasm: the wasm stays the one file the page names
		for (const forbidden of NO_ASSET_OF_SQLITE) {
			expect(workerText, forbidden).not.toContain(forbidden)
		}
		const pageChunks = files.filter(isAppMainScript)
		expect(pageChunks.length).toBeGreaterThan(0)
		for (const fragment of ['sqlite3ApiBootstrap', ENGINE_ONLY_MARKER, 'sqlite-engine']) {
			const holding = await filesHolding({ directory, files: pageChunks, fragment })
			expect(holding, fragment).toEqual([])
		}
	})

	it('an app’s build whose page imports only core’s SQLite entry, no worker file → no engine emitted, exactly one wasm file, the hub’s worker once', async () => {
		const directory = path.join(REGISTER_ONLY_APP, 'dist')
		const files = await filesUnder({ directory })
		expect(files.filter(isAppMainScript).length).toBeGreaterThan(0)
		expect(files.filter(isEngineWorker)).toEqual([])
		expect(files.filter(isWasmFile)).toEqual([
			expect.stringMatching(/^assets\/sqlite3-[\w-]+\.wasm$/),
		])
		expect(files.filter(isHubWorker)).toHaveLength(1)
		for (const fragment of ['sqlite3ApiBootstrap', ENGINE_ONLY_MARKER, 'sqlite-engine']) {
			const holding = await filesHolding({ directory, files, fragment })
			expect(holding, fragment).toEqual([])
		}
	})

	it('an app’s dev server, the optimizer left to its default → the pre-bundled copy of core’s SQLite entry the page loads reaches the engine’s chunk by import() only, and no other optimized file holds the engine', async () => {
		const config = await resolveConfig(
			{
				configFile: false,
				root: APP,
				logLevel: 'silent',
				cacheDir: path.join(WORK, 'optimizer-cache'),
			},
			'serve',
		)
		const metadata = await optimizeDeps(config, true)
		const entry = metadata.optimized['@dialecte/core/sqlite']
		expect(entry, 'the optimizer pre-bundled @dialecte/core/sqlite').toBeDefined()
		const code = await textOf({ file: entry!.file })
		expect(code).toMatch(/import\(\s*["'][^"']*sqlite-engine[^"']*\.js[^"']*["']\s*\)/)
		expect(code).not.toMatch(/(?:from|import)\s*["'][^"']*sqlite-engine[^"']*\.js/)
		const directory = path.dirname(entry!.file)
		const files = (await filesUnder({ directory })).filter((file) => file.endsWith('.js'))
		const holdingEngine = await filesHolding({ directory, files, fragment: 'sqlite3ApiBootstrap' })
		expect(holdingEngine.length).toBeGreaterThan(0)
		expect(holdingEngine.every((file) => file.startsWith('sqlite-engine'))).toBe(true)
		expect(code).not.toContain('sqlite3ApiBootstrap')
	})

	it('a consumer’s dev server → the wasm URL of core’s SQLite entry answers the wasm', async () => {
		const server = await createServer({
			configFile: false,
			root: APP,
			logLevel: 'silent',
			server: { port: 0, fs: { allow: [WORK, CORE_ROOT] } },
		})
		await server.listen()
		try {
			const reachable = await chunksReachedFrom({ entry: 'sqlite.js' })
			const [wasmChunk] = chunksHolding({ chunks: reachable, fragment: WASM_URL_EXPRESSION })
			const transformed = await server.transformRequest(`/@fs${path.join(CORE_DIST, wasmChunk!)}`)
			const wasmPath = /new URL\(["']([^"']*sqlite3[^"']*\.wasm)["']/.exec(
				transformed?.code ?? '',
			)?.[1]
			expect(wasmPath).toBeDefined()
			const address = server.resolvedUrls?.local[0]
			const response = await fetch(new URL(wasmPath!, address))
			expect(response.status).toBe(200)
			const responseBuffer = await response.arrayBuffer()
			const head = new Uint8Array(responseBuffer).slice(0, 4)
			expect([...head]).toEqual([0x00, 0x61, 0x73, 0x6d])
		} finally {
			await server.close()
		}
	})

	it('core’s main build → the hub a worker chunk of its own, holding all it runs, reached from the SQLite entry as a SharedWorker', async () => {
		const files = await filesUnder({ directory: CORE_DIST })
		const hubChunks = files.filter(isHubChunk)
		expect(hubChunks).toHaveLength(1)
		const hub = await textOf({ file: path.join(CORE_DIST, hubChunks[0]!) })
		expect(hub).toContain('onconnect')
		expect(hub).not.toMatch(/^\s*import\b|\bfrom\s*["']/m)
		const referring = await fileHolding({
			directory: CORE_DIST,
			files: files.filter(isCoreMainScript),
			fragment: path.basename(hubChunks[0]!),
		})
		expect(referring).toBeDefined()
		const main = await textOf({ file: path.join(CORE_DIST, referring!) })
		expect(main).toContain('new SharedWorker(')
		const staticallyReachedChunks = await chunksReachedFrom({
			entry: 'sqlite.js',
			staticOnly: true,
		})
		expect(staticallyReachedChunks.has(referring!)).toBe(true)
		const reachedChunks = await chunksReachedFrom({ entry: 'index.js' })
		expect(reachedChunks.has(referring!)).toBe(false)
	})

	it('a consumer’s app build, importing @dialecte/core/sqlite for what it registers → the hub’s worker emitted once, reached from its main side', async () => {
		const files = await filesUnder({ directory: path.join(APP, 'dist') })
		const hubChunks = files.filter(isHubWorker)
		expect(hubChunks).toHaveLength(1)
		const referring = await fileHolding({
			directory: path.join(APP, 'dist'),
			files: files.filter(isAppMainScript),
			fragment: path.basename(hubChunks[0]!),
		})
		expect(referring).toBeDefined()
	})

	it('a consumer’s dev server → the hub’s URL in core’s SQLite entry answers its worker', async () => {
		const server = await createServer({
			configFile: false,
			root: APP,
			logLevel: 'silent',
			// core's main side imports comlink: no dependency run, which the close would wait for
			optimizeDeps: { noDiscovery: true },
			server: { port: 0, fs: { allow: [WORK, CORE_ROOT] } },
		})
		await server.listen()
		try {
			const files = await filesUnder({ directory: CORE_DIST })
			const referring = await fileHolding({
				directory: CORE_DIST,
				files: files.filter(isCoreMainScript),
				fragment: 'new SharedWorker(',
			})
			const modulePath = `/@fs${path.join(CORE_DIST, referring!)}`
			const transformed = await server.transformRequest(modulePath)
			const hubPath = /new URL\(["']([^"']*hub\.worker[^"']*\.js)["']/.exec(
				transformed?.code ?? '',
			)?.[1]
			expect(hubPath).toBeDefined()
			// the dev server maps it to the hub's chunk (served as a file: a transform would wait for the
			// dependency scan this case never lets finish)
			const resolved = await server.pluginContainer.resolveId(hubPath!)
			const hubChunk = files.find(isHubChunk)
			expect(resolved?.id).toBe(path.join(CORE_DIST, hubChunk!))
			const hub = await textOf({ file: resolved!.id })
			expect(hub).toContain('onconnect')
		} finally {
			await server.close()
		}
	})
})
