/**
 * Failover across real tabs on the built engine: the page of `failover.html` built for production (the hub's and the
 * engine's workers emitted), served from two origins. Per browser, three runs of: tab A hosts the project, tab B
 * reads it, A is closed - the time to B's read answered by the next engine (B hosts it now), with the machine's load.
 * Then a child page of the other origin, bound to a tab through a port the tab made: it reads the project, and is
 * refused `realm-dropped` once unbound.
 *
 *   npx tsx src/store/engine/hub/failover/hub-failover.script.ts <results folder> [chromium|firefox]
 *
 * Firefox runs on the local stock build (Playwright's does not start on this macOS): `FAILOVER_FIREFOX` names its
 * executable. Every run is written to `<results folder>/<browser>-<time>.json`.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { loadavg } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, firefox } from 'playwright'
import { build, preview } from 'vite'

import type { RealmWindow } from '../hub.browser.fixtures.types'
import type {
	CrossOriginChildOutcome,
	FailedBrowser,
	FailoverBrowserName,
	FailoverReport,
	FailoverRun,
	LaunchedBrowser,
} from './hub-failover.fixtures.types'
import type { Frame, Page } from 'playwright'
import type { PreviewServer } from 'vite'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const CORE_ROOT = path.resolve(HERE, '../../../../../')
const OUT_DIR = path.join(CORE_ROOT, 'node_modules/.tmp/hub-failover')
const MAIN_PORT = 5191
const CHILD_PORT = 5192
const MAIN_ORIGIN = `http://localhost:${MAIN_PORT}`
const CHILD_ORIGIN = `http://localhost:${CHILD_PORT}`
const RUNS = 3
/** How long a read may wait for the next engine before its run is kept as failed. */
const READ_BUDGET_MS = 30_000
/**
 * Run under tsx, the functions handed to the pages are kept named through a `__name` helper the pages lack: each
 * page gets one that keeps the function as it is.
 */
const KEEP_NAMES = 'globalThis.__name = function keepName(target) { return target }'
const FIREFOX_EXECUTABLE =
	process.env.FAILOVER_FIREFOX ??
	'/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox'

/** The failover page built for production, the hub's and the engine's workers emitted beside it. */
async function buildPage(): Promise<void> {
	await rm(OUT_DIR, { recursive: true, force: true })
	await build({
		configFile: false,
		root: HERE,
		base: './',
		logLevel: 'warn',
		resolve: { alias: { '@': path.join(CORE_ROOT, 'src') } },
		worker: { format: 'es' },
		build: {
			outDir: OUT_DIR,
			emptyOutDir: true,
			rollupOptions: { input: path.join(HERE, 'failover.html') },
		},
	})
}

async function serve(params: { port: number }): Promise<PreviewServer> {
	return preview({
		configFile: false,
		root: HERE,
		logLevel: 'warn',
		build: { outDir: OUT_DIR },
		preview: { port: params.port, strictPort: true, host: 'localhost' },
	})
}

async function launch(params: { name: FailoverBrowserName }): Promise<LaunchedBrowser> {
	const { name } = params
	if (name === 'chromium') return { name, browser: await chromium.launch({ headless: true }) }
	return {
		name,
		browser: await firefox.launch({
			headless: true,
			channel: 'moz-firefox',
			executablePath: FIREFOX_EXECUTABLE,
		}),
	}
}

/** A tab of the main origin, its realm booted: one that can start engines when `spawn`. */
async function openTab(params: { page: Page; spawn: boolean }): Promise<void> {
	await params.page.goto(`${MAIN_ORIGIN}/failover.html?spawn=${params.spawn ? 1 : 0}`)
	await params.page.waitForFunction(function realmStarted() {
		return Boolean((window as RealmWindow).realmReady)
	})
	await params.page.evaluate(function realmJoined() {
		return (window as RealmWindow).realmReady!.then(function joined() {
			return undefined
		})
	})
}

/** The project's documents read through the tab's realm. */
function documentIdsOf(params: { page: Page; project: string }): Promise<string[]> {
	return params.page.evaluate(function readThroughRealm(project) {
		return (window as RealmWindow).realmReady!.then(function read(realm) {
			return realm.documentIds({ project })
		})
	}, params.project)
}

/** One failover: A hosts the project, B reads it, A's tab closes, B's next read waits for the next engine. */
async function failoverRun(params: {
	launched: LaunchedBrowser
	run: number
}): Promise<FailoverRun> {
	const { launched, run } = params
	const context = await launched.browser.newContext()
	await context.addInitScript({ content: KEEP_NAMES })
	try {
		const project = `failover-${crypto.randomUUID()}`
		const host = await context.newPage()
		await openTab({ page: host, spawn: true })
		await host.evaluate(function registerThroughRealm(project) {
			return (window as RealmWindow).realmReady!.then(function register(realm) {
				return realm.registerDocument({ project, id: 'doc-1' })
			})
		}, project)
		const reader = await context.newPage()
		await openTab({ page: reader, spawn: true })
		const before = await documentIdsOf({ page: reader, project })
		if (before.join() !== 'doc-1')
			throw new Error(`the reader read ${before.join()} before the failover`)
		const endedAt = performance.now()
		await host.close()
		const after = await withinBudget({ work: documentIdsOf({ page: reader, project }) })
		const readAnsweredMs = Math.round(performance.now() - endedAt)
		if (after.join() !== 'doc-1')
			throw new Error(`the reader read ${after.join()} after the failover`)
		return { run, readAnsweredMs, load: loadavg() }
	} catch (thrown) {
		// kept with its load, as every run is: the next runs go on
		return { run, failed: String(thrown), load: loadavg() }
	} finally {
		await context.close()
	}
}

/** A child page of the other origin bound to a tab through a port the tab made: read while bound, then unbound. */
async function crossOriginChild(params: {
	launched: LaunchedBrowser
}): Promise<CrossOriginChildOutcome> {
	const context = await params.launched.browser.newContext()
	await context.addInitScript({ content: KEEP_NAMES })
	try {
		const project = `failover-child-${crypto.randomUUID()}`
		const page = await context.newPage()
		await openTab({ page, spawn: true })
		await page.evaluate(function registerThroughRealm(project) {
			return (window as RealmWindow).realmReady!.then(function register(realm) {
				return realm.registerDocument({ project, id: 'doc-1' })
			})
		}, project)
		await page.evaluate(function addChildFrame(childOrigin) {
			const frame = document.createElement('iframe')
			frame.src = `${childOrigin}/failover.html?bound=1`
			frame.id = 'child'
			document.body.append(frame)
		}, CHILD_ORIGIN)
		const frame = await childFrameOf({ page })
		await frame.waitForFunction(function childStarted() {
			return Boolean((window as RealmWindow).realmReady)
		})
		await page.evaluate(function bindChild(childOrigin) {
			return (window as RealmWindow).realmReady!.then(function postPort(realm) {
				const handle = realm.createHubPort()
				const childWindow = (document.getElementById('child') as HTMLIFrameElement).contentWindow!
				childWindow.postMessage({ type: 'hub-port', port: handle.port }, childOrigin, [handle.port])
				;(window as unknown as { childHandle: typeof handle }).childHandle = handle
			})
		}, CHILD_ORIGIN)
		const readWhileBound = await frame.evaluate(function readThroughChild(project) {
			return (window as RealmWindow).realmReady!.then(function read(realm) {
				return realm.documentIds({ project })
			})
		}, project)
		await page.evaluate(function unbindChild() {
			;(window as unknown as { childHandle: { unbind: () => void } }).childHandle.unbind()
		})
		const readOnceUnbound = await frame.evaluate(async function readUntilRefused(project) {
			const realm = await (window as RealmWindow).realmReady!
			for (let attempt = 0; attempt < 50; attempt++) {
				try {
					await realm.documentIds({ project })
				} catch (thrown) {
					const cause = (thrown as { cause?: { key?: string; meta?: { reason?: string } } }).cause
					return `${cause?.key} ${cause?.meta?.reason ?? ''}`.trim()
				}
				await new Promise(function waitAWhile(resolve) {
					setTimeout(resolve, 100)
				})
			}
			return 'still answered'
		}, project)
		return { readWhileBound, readOnceUnbound }
	} finally {
		await context.close()
	}
}

/** The tab's frame of the other origin, once attached. */
async function childFrameOf(params: { page: Page }): Promise<Frame> {
	const deadline = performance.now() + READ_BUDGET_MS
	for (;;) {
		const frame = params.page.frames().find(function isChild(candidate) {
			return candidate.url().startsWith(CHILD_ORIGIN)
		})
		if (frame) return frame
		if (performance.now() >= deadline) throw new Error('the child frame never attached')
		await new Promise(function waitAWhile(resolve) {
			setTimeout(resolve, 50)
		})
	}
}

function withinBudget<GenericResult>(params: {
	work: Promise<GenericResult>
}): Promise<GenericResult> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const late = new Promise<never>(function refuseLate(_resolve, reject) {
		timer = setTimeout(function tooLate() {
			reject(new Error(`no answer within ${READ_BUDGET_MS} ms`))
		}, READ_BUDGET_MS)
	})
	return Promise.race([params.work, late]).finally(function clearBudget() {
		clearTimeout(timer)
	})
}

function isBrowserName(name: string): name is FailoverBrowserName {
	return name === 'chromium' || name === 'firefox'
}

async function measure(params: { name: FailoverBrowserName }): Promise<FailoverReport> {
	const launched = await launch(params)
	try {
		const runs: FailoverRun[] = []
		for (let run = 1; run <= RUNS; run++) runs.push(await failoverRun({ launched, run }))
		let crossOrigin: FailoverReport['crossOriginChild']
		try {
			crossOrigin = await crossOriginChild({ launched })
		} catch (thrown) {
			crossOrigin = { failed: String(thrown) }
		}
		return {
			browser: params.name,
			at: new Date().toISOString(),
			runs,
			crossOriginChild: crossOrigin,
		}
	} finally {
		await launched.browser.close()
	}
}

async function main(): Promise<void> {
	const [resultsFolder, only] = process.argv.slice(2)
	if (!resultsFolder || (only !== undefined && !isBrowserName(only))) {
		throw new Error('usage: hub-failover.script.ts <results folder> [chromium|firefox]')
	}
	const browsers: FailoverBrowserName[] = only ? [only] : ['chromium', 'firefox']
	await buildPage()
	const servers: PreviewServer[] = []
	try {
		servers.push(await serve({ port: MAIN_PORT }))
		servers.push(await serve({ port: CHILD_PORT }))
		await mkdir(resultsFolder, { recursive: true })
		for (const name of browsers) {
			let report: FailoverReport | FailedBrowser
			try {
				report = await measure({ name })
			} catch (thrown) {
				report = { browser: name, failed: String(thrown) }
			}
			const file = path.join(
				resultsFolder,
				`${name}-${new Date().toISOString().replaceAll(':', '-')}.json`,
			)
			await writeFile(file, JSON.stringify(report, null, '\t'))
			console.info(JSON.stringify(report))
		}
	} finally {
		for (const server of servers) await server.close()
	}
}

await main()
