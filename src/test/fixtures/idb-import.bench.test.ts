import { afterAll, describe, expect, it } from 'vitest'

/**
 * Import load harness — runs in core's browser vitest (real Chromium, real IndexedDB via
 * Dexie). Node can't measure the `local` store (no IndexedDB), so the store breakdown must
 * happen here. Both stores run in the SAME engine, so a delta is pure store cost.
 *
 * It dumps the full import breakdown from the dev `perf` spans/counts, so we can see WHERE
 * a load spends its time (SAX vs resolveChildren vs the Dexie write vs the per-file schema
 * reopen), and COMPARE a generated stress fixture against a REAL production SCL file
 * (`./data/real-scl.ssd`, git-ignored — drop your own there) on the same pipeline.
 *
 * Gated by `--mode bench` so the normal suite / CI skips the heavy imports. Generate the
 * stress fixtures first (`generate-stress-fixtures.ts` → git-ignored `data/`). Run:
 *
 *   npx vitest run --mode bench src/test/fixtures/idb-import.bench.test.ts
 *
 * Read the `[LOAD]` lines from the browser console. Big sizes (100+ MB) may exceed browser
 * memory/quota — keep the IndexedDB sizes small.
 */
import { Project } from '@/project/project'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { PerfReport } from '@/perf'
import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
// Only runs under `--mode bench` (or VITE_BENCH=1) so the normal suite / CI skips the heavy imports.
const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'

// All generated fixtures currently on disk. IndexedDB is the real production store, so the
// point of this run is to see whether the decoder + mutable-parser wins carry to `local`.
const ALL_SIZES = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const IN_MEMORY_SIZES = ALL_SIZES
const LOCAL_SIZES = ALL_SIZES

// 3-minute cap per import; once a `local` import caps, skip the bigger ones (stop-on-timeout).
const CAP_MS = 180_000
let localCapped = false
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
const realUrl = (): URL => new URL('./data/real-scl.ssd', import.meta.url)

/** Import `xml` once, return the wall time + the dev perf report for a full breakdown. */
async function importOnce(
	xml: string,
	storage: 'inMemory' | 'local',
): Promise<{ importMs: number; report: PerfReport }> {
	const project = await new Project({
		configs: { default: CONFIG },
		defaultConfigKey: 'default',
		storage: storage === 'local' ? { type: 'local' } : { type: 'inMemory' },
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
	const calls = (n: string): string => r[n]?.calls?.toLocaleString() ?? '·'
	const accounted =
		(r['core::import::sax']?.totalMs ?? 0) +
		(r['core::import::resolveChildren']?.totalMs ?? 0) +
		(r['core::store::bulkWrite']?.totalMs ?? 0) +
		(r['core::store::reopenSchema']?.totalMs ?? 0)
	const unaccounted = Math.max(0, importMs - accounted)
	return [
		`[LOAD] ${label} (${storage}): import ${importMs.toFixed(0)}ms  (unaccounted ~${unaccounted.toFixed(0)}ms)`,
		`  sax ${ms('core::import::sax')} | resolveChildren ${ms('core::import::resolveChildren')} | reopenSchema ${ms('core::store::reopenSchema')} | commit ${ms('core::commit')} ms`,
		`  bulkWrite ${ms('core::store::bulkWrite')}ms = add ${ms('core::store::bulkWrite::add')} / update ${ms('core::store::bulkWrite::update')} / delete ${ms('core::store::bulkWrite::delete')} ms`,
		`  sax handlers (self ms/calls): onOpenTag ${ms('core::import::onOpenTag')}/${calls('core::import::onOpenTag')} | onText ${ms('core::import::onText')}/${calls('core::import::onText')} | onCloseTag ${ms('core::import::onCloseTag')}/${calls('core::import::onCloseTag')}`,
	].join('\n')
}

async function run(label: string, xml: string, storage: 'inMemory' | 'local'): Promise<PerfReport> {
	const { importMs, report } = await importOnce(xml, storage)
	const line = breakdown(label, storage, importMs, report)
	LINES.push(line)
	console.log(line)
	return report
}

describe('import load harness — breakdown + generated-vs-real (browser)', () => {
	for (const mb of IN_MEMORY_SIZES) {
		it.runIf(RUN)(
			`generated ${mb}MB — inMemory`,
			async () => {
				const report = await run(`generated ${mb}MB`, await fetchText(stressUrl(mb)), 'inMemory')
				// The SAX handlers must fire (one call per element) — proves the parser wiring.
				expect(report['core::import::onOpenTag']?.calls ?? 0).toBeGreaterThan(0)
			},
			600_000,
		)
	}

	for (const mb of LOCAL_SIZES) {
		it.runIf(RUN)(
			`generated ${mb}MB — local(IndexedDB)`,
			async (ctx) => {
				if (localCapped) {
					ctx.skip()
					return
				}
				try {
					const report = await withCap(
						`local ${mb}MB`,
						run(`generated ${mb}MB`, await fetchText(stressUrl(mb)), 'local'),
					)
					// The Dexie-only store spans must fire on the real IndexedDB path.
					expect(report['core::store::bulkWrite::add']?.calls ?? 0).toBeGreaterThanOrEqual(1)
				} catch (err) {
					localCapped = true
					LINES.push(
						`[LOAD] generated ${mb}MB (local): ${(err as Error).message} — stopping bigger files`,
					)
					console.log(LINES.at(-1))
					throw err
				}
			},
			CAP_MS + 20_000,
		)
	}

	afterAll(() => {
		if (RUN) console.log(`\n===== IndexedDB bench summary =====\n${LINES.join('\n')}`)
	})

	// Real production SCL for comparison — same pipeline, real element shapes/depth.
	it.runIf(RUN)(
		'real production SCL — inMemory vs local',
		async () => {
			const xml = await fetchText(realUrl())
			await run('real-scl.ssd', xml, 'inMemory')
			await run('real-scl.ssd', xml, 'local')
		},
		600_000,
	)
})
