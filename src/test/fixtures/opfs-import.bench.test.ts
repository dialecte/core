import { afterAll, describe, expect, it } from 'vitest'

/**
 * OPFS/SQLite import harness — runs in core's browser vitest (real Chromium, real OPFS,
 * real Worker, real sqlite-wasm `opfs-sahpool`). The mirror of `idb-import.bench.test.ts`:
 * same fixtures, same engine, same pipeline — only the store differs (`{ type: 'opfs' }`),
 * so an inMemory→opfs delta is pure store cost (worker round-trip + SQLite write).
 *
 * Why here and not in SET: core's own Vite serves `sqlite.worker.ts` directly, so the worker
 * + inlined wasm load cleanly. This isolates the STORE from SET's dev-link bundling, proving
 * the SQLite path works and measuring it on the real fixtures before wiring SET further.
 *
 * SMOKE first: open+close an opfs project with a hard cap, so a worker-open HANG FAILS fast
 * instead of blocking the suite. Then the size sweep, each import capped the same way.
 *
 * Gated by `--mode bench` (or VITE_BENCH=1) so the normal suite / CI skips the heavy imports.
 * Fixtures live in the git-ignored `./data/` (generate-stress-fixtures.ts). Run:
 *
 *   npx vitest run --mode bench src/test/fixtures/opfs-import.bench.test.ts
 *
 * Read the `[OPFS]` lines from the browser console.
 */
import { Project } from '@/project/project'
import { SqliteStore } from '@/store/opfs/sqlite-store'
import { TEST_DIALECTE_CONFIG } from '@/test'
import { parseXmlFile } from '@/xml'

import type { PerfReport } from '@/perf'
import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'

// Full IndexedDB fixture range so opfs timings line up 1:1 with idb-import.bench numbers.
const SIZES = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

// 3-minute cap per open/import; once one caps, skip the bigger ones (stop-on-timeout).
const CAP_MS = 180_000
let opfsCapped = false
const LINES: string[] = []

async function withCap<GenericResult>(
	label: string,
	p: Promise<GenericResult>,
): Promise<GenericResult> {
	let timer: ReturnType<typeof setTimeout>
	const cap = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`CAP ${CAP_MS / 1000}s exceeded: ${label}`)), CAP_MS)
	})
	try {
		return await Promise.race([p, cap])
	} finally {
		clearTimeout(timer!)
	}
}

async function fetchText(url: URL): Promise<string> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`fixture missing (${res.status}) at ${url} — generate/copy it first`)
	return res.text()
}

const stressUrl = (mb: number): URL => new URL(`./data/stress-${mb}mb.xml`, import.meta.url)

/** Import `xml` once into a fresh store, return the wall time + the dev perf report. */
async function importOnce(
	xml: string,
	storage: 'inMemory' | 'opfs',
): Promise<{ importMs: number; report: PerfReport }> {
	const project = await new Project({
		configs: { default: CONFIG },
		defaultConfigKey: 'default',
		// Unique name → unique sahpool VFS name → no cross-run OPFS lock contention.
		storage: storage === 'opfs' ? { type: 'opfs' } : { type: 'inMemory' },
		dev: { perf: true },
	}).open(`load-${storage}-${crypto.randomUUID()}`)

	// The User-Timing timeline is global; clear it so this run isn't summed with the last.
	performance.clearMarks()
	performance.clearMeasures()

	const t = performance.now()
	const [imp] = await project.import([new File([xml], 'load.xml', { type: 'text/xml' })], {
		useCustomRecordsIds: false,
	})
	const importMs = performance.now() - t
	const report = project.openDocument(imp.documentId).perf.report()
	await project.destroy()
	return { importMs, report }
}

function breakdown(label: string, storage: string, importMs: number, r: PerfReport): string {
	const ms = (n: string): string => r[n]?.totalMs?.toFixed(0) ?? '·'
	// SAX runs on the main thread for both stores; only the SQLite write goes to the worker,
	// so for opfs the store cost surfaces as "unaccounted" (Comlink round-trip + SQL).
	const records = r['core::import::onOpenTag']?.calls ?? 0
	const accounted =
		(r['core::import::sax']?.totalMs ?? 0) + (r['core::import::resolveChildren']?.totalMs ?? 0)
	const storeMs = Math.max(0, importMs - accounted)
	const perSec = importMs > 0 ? Math.round(records / (importMs / 1000)) : 0
	return [
		`[OPFS] ${label} (${storage}): import ${importMs.toFixed(0)}ms  (${perSec.toLocaleString()} rec/s, ${records.toLocaleString()} recs)`,
		`  sax ${ms('core::import::sax')} | resolveChildren ${ms('core::import::resolveChildren')} | store+worker (unaccounted) ~${storeMs.toFixed(0)} ms`,
	].join('\n')
}

async function run(label: string, xml: string, storage: 'inMemory' | 'opfs'): Promise<PerfReport> {
	const { importMs, report } = await importOnce(xml, storage)
	const line = breakdown(label, storage, importMs, report)
	LINES.push(line)
	// console.warn (not log) — vitest browser mode only forwards warn to the terminal.
	console.warn(line)
	return report
}

/**
 * Import via the worker's own parser (`store.importDocument`): the SAX parse runs INSIDE the
 * OPFS worker against the in-worker engine, so records never cross Comlink — the clone the
 * `opfs` arm pays per batch is gone. Hookless (TEST config has no hooks), so this is the
 * upper bound of the parse-in-worker win.
 */
async function importViaParseInWorker(label: string, xml: string): Promise<void> {
	const store = new SqliteStore(`piw-${crypto.randomUUID()}`, {
		recordSchema: CONFIG.database.recordSchema,
	})
	await store.open()
	const documentId = crypto.randomUUID()
	await store.registerDocument({
		id: documentId,
		name: 'load',
		extension: '.xml',
		configKey: 'default',
		createdAt: Date.now(),
	})
	const file = new File([xml], 'load.xml', { type: 'text/xml' })
	const t = performance.now()
	const records = await store.importDocument(documentId, file, CONFIG)
	const importMs = performance.now() - t
	await store.destroy()
	const perSec = importMs > 0 ? Math.round(records / (importMs / 1000)) : 0
	const line = `[OPFS] ${label} (opfs-parse-in-worker): import ${importMs.toFixed(0)}ms  (${perSec.toLocaleString()} rec/s, ${records.toLocaleString()} recs)`
	LINES.push(line)
	console.warn(line)
}

describe('OPFS/SQLite import harness — smoke + inMemory-vs-opfs (browser)', () => {
	// SMOKE: prove the worker opens and the sahpool VFS initializes, capped so a hang FAILS.
	it.runIf(RUN)(
		'smoke — open + close an opfs project (worker + sahpool init)',
		async () => {
			const project = await withCap(
				'opfs open',
				new Project({
					configs: { default: CONFIG },
					defaultConfigKey: 'default',
					storage: { type: 'opfs' },
				}).open(`smoke-${crypto.randomUUID()}`),
			)
			const docs = await project.getDocuments()
			expect(docs).toEqual([])
			await project.destroy()
		},
		CAP_MS + 20_000,
	)

	for (const mb of SIZES) {
		it.runIf(RUN)(
			`generated ${mb}MB — opfs(SQLite)`,
			async (ctx) => {
				if (opfsCapped) {
					ctx.skip()
					return
				}
				try {
					const xml = await fetchText(stressUrl(mb))
					// Baseline on the SAME fixture, then the opfs store — delta is store cost.
					await run(`generated ${mb}MB`, xml, 'inMemory')
					const report = await withCap(`opfs ${mb}MB`, run(`generated ${mb}MB`, xml, 'opfs'))
					// Same store, but the parser runs IN the worker (no per-record clone).
					await withCap(`piw ${mb}MB`, importViaParseInWorker(`generated ${mb}MB`, xml))
					// One record per element must have landed through the worker store.
					expect(report['core::import::onOpenTag']?.calls ?? 0).toBeGreaterThan(0)
				} catch (err) {
					opfsCapped = true
					LINES.push(
						`[OPFS] generated ${mb}MB (opfs): ${(err as Error).message} — stopping bigger files`,
					)
					console.warn(LINES.at(-1))
					throw err
				}
			},
			CAP_MS + 20_000,
		)
	}

	afterAll(() => {
		if (RUN) console.warn(`\n===== OPFS/SQLite bench summary =====\n${LINES.join('\n')}`)
	})
})

// Clone-cost isolation: run the SAME parser+engine in-process (SqliteStore memory mode, no
// worker, no Comlink structured clone) vs the worker path. If in-process is much faster, the
// marshalling clone is the ceiling (parse-in-worker pays off); if it matches the worker, the
// cost is SQL insert + per-row JSON.stringify (parse-in-worker is a UX win, not throughput).
describe('OPFS/SQLite — clone-cost isolation (in-process SQLite vs worker)', () => {
	async function importViaSqliteMemory(
		xml: string,
	): Promise<{ importMs: number; records: number }> {
		const store = new SqliteStore(`mem-${crypto.randomUUID()}`, {
			recordSchema: CONFIG.database.recordSchema,
			mode: 'memory',
		})
		await store.open()
		const documentId = crypto.randomUUID()
		await store.registerDocument({
			id: documentId,
			name: 'load',
			extension: '.xml',
			configKey: 'default',
			createdAt: Date.now(),
		})
		const file = new File([xml], 'load.xml', { type: 'text/xml' })
		const t = performance.now()
		await store.beginImport(documentId)
		const { recordCount } = await parseXmlFile({ file, documentId, store, config: CONFIG })
		await store.finalizeImport(documentId)
		const importMs = performance.now() - t
		await store.destroy()
		return { importMs, records: recordCount }
	}

	for (const mb of [20, 50]) {
		it.runIf(RUN)(
			`generated ${mb}MB — sqlite in-process (no worker)`,
			async () => {
				const xml = await fetchText(stressUrl(mb))
				const { importMs, records } = await importViaSqliteMemory(xml)
				const perSec = Math.round(records / (importMs / 1000))
				console.warn(
					`[OPFS] generated ${mb}MB (sqlite-inprocess): import ${importMs.toFixed(0)}ms  (${perSec.toLocaleString()} rec/s, ${records.toLocaleString()} recs)`,
				)
				expect(records).toBeGreaterThan(0)
			},
			CAP_MS + 20_000,
		)
	}
})
