import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, createServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** The package's root: core's own build configs are read from there. */
const CORE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
/** Everything a run builds, removed after it. */
const WORK = path.join(CORE_ROOT, '.tmp', `packaging-${process.pid}`)
const CORE_DIST = path.join(WORK, 'core')
const DIALECTE = path.join(WORK, 'dialecte')
const APP = path.join(WORK, 'app')

/** What a dialecte package and a consumer reach of core: its main side, its engine, its wasm URL module. */
const CORE_ALIASES = {
	'@dialecte/core/engine': path.join(CORE_DIST, 'engine.js'),
	'@dialecte/core/wasm': path.join(CORE_DIST, 'wasm.js'),
	'@dialecte/core': path.join(CORE_DIST, 'index.js'),
}

/** A dialecte package, as nsd ships one: two engine workers (two dialectes) exported by URL, core kept external. */
const DIALECTE_FILES: Record<string, string> = {
	'dialecte.ts': [
		"import { defineDialecte } from '@dialecte/core'",
		"export const DIALECTE = defineDialecte({ id: 'fixture', version: '0.0.0', configs: { default: {} as never }, defaultConfigKey: 'default' })",
		"export const OTHER_DIALECTE = defineDialecte({ id: 'fixture-other', version: '0.0.0', configs: { default: {} as never }, defaultConfigKey: 'default' })",
	].join('\n'),
	'engine-a.worker.ts': [
		"import { serveDialecteEngine } from '@dialecte/core/engine'",
		"import { DIALECTE } from './dialecte'",
		'serveDialecteEngine({ dialecte: DIALECTE })',
	].join('\n'),
	'engine-b.worker.ts': [
		"import { serveDialecteEngine } from '@dialecte/core/engine'",
		"import { OTHER_DIALECTE } from './dialecte'",
		'serveDialecteEngine({ dialecte: OTHER_DIALECTE })',
	].join('\n'),
	'index.ts': [
		"import engineA from './engine-a.worker.ts?worker&url'",
		"import engineB from './engine-b.worker.ts?worker&url'",
		"export { SQLITE_WASM_URL } from '@dialecte/core/wasm'",
		'export const ENGINE_URLS = [engineA, engineB]',
	].join('\n'),
}

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

/** The entry's chunk and every chunk it imports, statically or dynamically, in core's build. */
async function chunksReachedFrom(params: { entry: string }): Promise<Map<string, string>> {
	const reached = new Map<string, string>()
	const pending = [params.entry]
	while (pending.length > 0) {
		const file = pending.pop()!
		if (reached.has(file)) continue
		const text = await textOf({ file: path.join(CORE_DIST, file) })
		reached.set(file, text)
		// static (`from "./x.js"`, `import "./x.js"`) and dynamic (`import("../x.js")`) imports, from the importer's folder
		for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
			pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]!)))
		}
	}
	return reached
}

beforeAll(async () => {
	await rm(WORK, { recursive: true, force: true })
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
	// core's main side holding the wasm URL, built with the main build's settings as an entry of its own
	await build({
		configFile: false,
		root: CORE_ROOT,
		base: './',
		logLevel: 'silent',
		build: {
			outDir: CORE_DIST,
			emptyOutDir: false,
			lib: {
				entry: { wasm: path.join(CORE_ROOT, 'src/store/sqlite/sqlite-wasm-url.ts') },
				formats: ['es'],
			},
			rollupOptions: { output: { entryFileNames: '[name].js' } },
		},
	})
	await mkdir(DIALECTE, { recursive: true })
	for (const [name, source] of Object.entries(DIALECTE_FILES)) {
		await writeFile(path.join(DIALECTE, name), source)
	}
	await build({
		configFile: false,
		root: DIALECTE,
		base: './',
		logLevel: 'silent',
		resolve: { alias: CORE_ALIASES },
		worker: { format: 'es' },
		build: {
			outDir: path.join(DIALECTE, 'dist'),
			lib: { entry: { index: path.join(DIALECTE, 'index.ts') }, formats: ['es'] },
			rollupOptions: { external: [/^@dialecte\/core/] },
		},
	})
	await mkdir(APP, { recursive: true })
	await writeFile(
		path.join(APP, 'main.js'),
		[
			`import { SQLITE_WASM_URL, ENGINE_URLS } from '${path.join(DIALECTE, 'dist', 'index.js')}'`,
			"import { connectHub } from '@dialecte/core'",
			'console.log(SQLITE_WASM_URL, ENGINE_URLS, connectHub)',
		].join('\n'),
	)
	await writeFile(path.join(APP, 'index.html'), '<script type="module" src="./main.js"></script>')
	await build({
		configFile: false,
		root: APP,
		logLevel: 'silent',
		resolve: { alias: CORE_ALIASES },
		build: { outDir: path.join(APP, 'dist') },
	})
}, 120_000)

afterAll(async () => {
	await rm(WORK, { recursive: true, force: true })
})

describe('the engine as a dialecte and a consumer bundle it', () => {
	it('core’s two builds → the engine entry beside the main ones, no asset of sqlite-wasm in it', async () => {
		const files = await filesUnder({ directory: CORE_DIST })
		expect(files).toEqual(expect.arrayContaining(['index.js', 'engine.js', 'engine.d.ts']))
		expect(files.filter((file) => file.includes('worker1'))).toEqual([])
		const engine = await textOf({ file: path.join(CORE_DIST, 'engine.js') })
		for (const forbidden of NO_ASSET_OF_SQLITE) expect(engine, forbidden).not.toContain(forbidden)
	})

	it('core’s main entry → no chunk it reaches imports sqlite-wasm or holds it: an engine in the page is not on the main side', async () => {
		const mainChunks = await chunksReachedFrom({ entry: 'index.js' })
		const reachingSqlite = [...mainChunks]
			.filter(([, text]) => SQLITE_MODULE_IMPORT.test(text) || text.includes('sqlite3ApiBootstrap'))
			.map(([file]) => file)
		expect(reachingSqlite).toEqual([])
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

	it('core’s main side (a synthetic entry of the wasm URL module, until the local store moves to SQLite) → the one wasm beside it, referenced by a URL a consumer’s bundler resolves', async () => {
		expect(await filesUnder({ directory: CORE_DIST })).toContain('sqlite3.wasm')
		expect(await textOf({ file: path.join(CORE_DIST, 'wasm.js') })).toContain(
			'new URL("sqlite3.wasm", import.meta.url)',
		)
	})

	it('a dialecte with two engine workers → neither worker chunk holds a wasm or a URL to one', async () => {
		const assets = (await filesUnder({ directory: path.join(DIALECTE, 'dist') })).filter((file) =>
			file.includes('.worker'),
		)
		expect(assets).toHaveLength(2)
		for (const asset of assets) {
			const chunk = await textOf({ file: path.join(DIALECTE, 'dist', asset) })
			for (const forbidden of NO_ASSET_OF_SQLITE)
				expect(chunk, `${asset}: ${forbidden}`).not.toContain(forbidden)
			expect(chunk, asset).not.toMatch(/from\s*["']@dialecte\/core/)
		}
	})

	it('a consumer’s app build → exactly one wasm file, content-hashed, for every engine', async () => {
		const files = await filesUnder({ directory: path.join(APP, 'dist') })
		expect(files.filter((file) => file.endsWith('.wasm'))).toEqual([
			expect.stringMatching(/^assets\/sqlite3-[\w-]+\.wasm$/),
		])
		// the two engines (the hub is a worker too, of core's main side)
		expect(files.filter(isEngineWorker)).toHaveLength(2)
		const [wasm] = files.filter((file) => file.endsWith('.wasm'))
		const mainChunks = files.filter((file) => file.endsWith('.js') && !file.includes('.worker'))
		const holding = await Promise.all(
			mainChunks.map(async (file) =>
				(await textOf({ file: path.join(APP, 'dist', file) })).includes(path.basename(wasm!)),
			),
		)
		expect(holding.some(Boolean)).toBe(true)
	})

	it('a consumer’s dev server → the wasm URL of core’s main side answers the wasm', async () => {
		const server = await createServer({
			configFile: false,
			root: APP,
			logLevel: 'silent',
			resolve: { alias: CORE_ALIASES },
			server: { port: 0, fs: { allow: [WORK, CORE_ROOT] } },
		})
		await server.listen()
		try {
			const transformed = await server.transformRequest(`/@fs${path.join(CORE_DIST, 'wasm.js')}`)
			const wasmPath = /new URL\(["']([^"']*sqlite3[^"']*\.wasm)["']/.exec(
				transformed?.code ?? '',
			)?.[1]
			expect(wasmPath).toBeDefined()
			const address = server.resolvedUrls?.local[0]
			const response = await fetch(new URL(wasmPath!, address))
			expect(response.status).toBe(200)
			const head = new Uint8Array(await response.arrayBuffer()).slice(0, 4)
			expect([...head]).toEqual([0x00, 0x61, 0x73, 0x6d])
		} finally {
			await server.close()
		}
	})

	it('core’s main build → the hub a worker chunk of its own, holding all it runs, reached from the main side as a SharedWorker', async () => {
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
	})

	it('a consumer’s app build → the hub’s worker emitted once, reached from its main side', async () => {
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

	it('a consumer’s dev server → the hub’s URL in core’s main side answers its worker', async () => {
		const server = await createServer({
			configFile: false,
			root: APP,
			logLevel: 'silent',
			resolve: { alias: CORE_ALIASES },
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
