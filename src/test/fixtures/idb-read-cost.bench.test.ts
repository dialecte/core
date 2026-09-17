import { afterAll, describe, expect, it } from 'vitest'

/**
 * Read-cost bench (browser, real IndexedDB via Dexie) — Phase 0 companion to the node
 * `audit-core-methods.ts`. The node audit runs the in-memory (Map) store and isolates
 * ALGORITHMIC cost; this one runs the SAME read methods on `local` (real IndexedDB) AND
 * `inMemory` in the same engine, so the delta is PURE store cost — the async round-trip
 * price SET actually pays.
 *
 * Why it matters: on IndexedDB every by-id `store.get` is an async round-trip. `getTree`
 * issues one per node, `getChildren` one per child, `getRecords` one per ref. This bench
 * quantifies how badly per-id round-trips dominate the real store (the batching / getMany
 * lever), versus tagName reads which Dexie serves from an index (`.where({ tagName })`).
 *
 * Gated by `--mode bench` (or VITE_BENCH=1) so the normal suite / CI skips it. Run:
 *   npx vitest run --mode bench src/test/fixtures/idb-read-cost.bench.test.ts
 *
 * Read the `[READ]` lines from the browser console. Keep sizes small — IndexedDB is slow.
 */
import { Project } from '@/project/project'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { PerfReport } from '@/perf'
import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'

const SIZES = [5, 10, 20]

/**
 * Reads should stay fast regardless of size (that's the point of the bench) — 60s is already
 * generous slack over the sub-2s numbers observed, while still catching a real regression.
 */
const READ_CAP_MS = 60_000

/**
 * Generous per-size budget for the IndexedDB import step alone. Import is a known-slow,
 * explicitly out-of-scope step for this read-perf bench (see the read-perf tracker's import
 * numbers) — it must NOT share a cap with the reads it gates. A flat 120s cap around import+reads
 * combined made every local(IndexedDB) run at 10MB+ fail before a single read even started, since
 * import alone already exceeds 120s there. ~13-20s/MB observed; this gives ample headless/CI slack.
 */
const importCapMs = (mb: number): number => Math.max(90_000, mb * 20_000)

type Ref = { tagName: string; id: string }
type Storage = 'inMemory' | 'local'

/** One measured method result. */
type Row = { method: string; ms: number; get: number; byTag: number; getMany: number }
/** method -> storage -> ms, for the final side-by-side. */
const RESULTS: Record<string, Partial<Record<Storage, number>>> = {}
const LINES: string[] = []

function fetchText(url: URL): Promise<string> {
	return fetch(url).then((res) => {
		if (!res.ok) throw new Error(`fixture missing (${res.status}) at ${url} — generate it first`)
		return res.text()
	})
}

const stressUrl = (mb: number): URL => new URL(`./data/stress-${mb}mb.xml`, import.meta.url)

function withCap<T>(label: string, ms: number, p: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout>
	const cap = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`CAP ${ms / 1000}s: ${label}`)), ms)
	})
	return Promise.race([p, cap]).finally(() => clearTimeout(timer!)) as Promise<T>
}

async function openImported(
	xml: string,
	storage: Storage,
): Promise<{
	project: Project<AnyDialecteConfig>
	doc: ReturnType<Project<AnyDialecteConfig>['openDocument']>
}> {
	const project = new Project({
		configs: { default: CONFIG },
		defaultConfigKey: 'default',
		storage: storage === 'local' ? { type: 'local' } : { type: 'inMemory' },
		dev: { perf: true },
	})
	await project.open(`read-${storage}-${crypto.randomUUID()}`)
	performance.clearMarks()
	performance.clearMeasures()
	const [imp] = await project.import([new File([xml], 'read.xml', { type: 'text/xml' })], {
		useCustomRecordsIds: false,
	})
	const doc = project.openDocument(imp.documentId)
	return { project, doc }
}

async function measure(
	doc: ReturnType<Project<AnyDialecteConfig>['openDocument']>,
	method: string,
	fn: () => Promise<unknown>,
	repeat = 1,
): Promise<Row> {
	doc.perf.reset()
	const t = performance.now()
	for (let i = 0; i < repeat; i++) await fn()
	const ms = (performance.now() - t) / repeat
	const r: PerfReport = doc.perf.report()
	return {
		method,
		ms,
		get: Math.round((r['core::store::get']?.count ?? 0) / repeat),
		byTag: Math.round((r['core::store::getByTagName']?.count ?? 0) / repeat),
		getMany: Math.round((r['core::store::getMany']?.count ?? 0) / repeat),
	}
}

async function runReads(
	doc: ReturnType<Project<AnyDialecteConfig>['openDocument']>,
	mb: number,
	storage: Storage,
): Promise<void> {
	const q = doc.query.any
	const [rootRec] = await q.getRecordsByTagName('Root')
	const [sampleRec] = await q.getRecordsByTagName('DDD_1')
	const rootRef: Ref = { tagName: rootRec.tagName, id: rootRec.id }
	const sampleRef: Ref = { tagName: sampleRec.tagName, id: sampleRec.id }
	const ddd = await q.getRecordsByTagName('DDD_1')
	const batchRefs = ddd.slice(0, 2000).map((r: Ref) => ({ tagName: r.tagName, id: r.id }))

	const rows: Row[] = []
	rows.push(await measure(doc, 'getRoot', () => doc.query.getRoot()))
	rows.push(await measure(doc, 'getRecord(byId)', () => q.getRecord(sampleRef), 50))
	rows.push(await measure(doc, 'getRecords(batch2k)', () => q.getRecords(batchRefs)))
	rows.push(await measure(doc, 'getRecordsByTagName', () => q.getRecordsByTagName('DDD_1')))
	rows.push(await measure(doc, 'getChild', () => q.getChild(rootRef, 'D'), 20))
	rows.push(await measure(doc, 'getChildren', () => q.getChildren(rootRef, 'D'), 5))
	rows.push(
		await measure(doc, 'findByAttributes', () =>
			q.findByAttributes({ tagName: 'DDD_1', attributes: { aDDD_1: 'x' } }),
		),
	)
	rows.push(await measure(doc, 'getTree(root)', () => q.getTree(rootRef)))
	rows.push(await measure(doc, 'getTree(root,depth:1)', () => q.getTree(rootRef, { depth: 1 })))
	rows.push(await measure(doc, 'getSnapshot', () => q.getSnapshot()))

	for (const row of rows) {
		RESULTS[row.method] ??= {}
		RESULTS[row.method][storage] = row.ms
		const line =
			`[READ] ${mb}MB ${storage.padEnd(8)} ${row.method.padEnd(20)} ` +
			`${row.ms.toFixed(2).padStart(10)} ms  store.get ${String(row.get).padStart(8)}  ` +
			`byTag ${String(row.byTag).padStart(5)}  getMany ${String(row.getMany).padStart(5)}`
		LINES.push(line)
		console.log(line)
	}
}

/** Import (capped generously, per-size — known slow, out of scope here) then time the reads (capped tight — they should stay fast). */
async function benchStorage(mb: number, storage: Storage): Promise<void> {
	const { project, doc } = await withCap(
		`${storage} ${mb}MB import`,
		importCapMs(mb),
		openImported(await fetchText(stressUrl(mb)), storage),
	)
	try {
		await withCap(`${storage} ${mb}MB reads`, READ_CAP_MS, runReads(doc, mb, storage))
	} finally {
		await project.destroy()
	}
}

describe('core read-cost bench — inMemory vs IndexedDB (browser)', () => {
	for (const mb of SIZES) {
		// vitest's own per-test timeout is the outer safety net; the real caps are the
		// import/read `withCap` calls inside benchStorage, which produce a labeled error
		// instead of vitest's generic "test timed out" once one of them trips.
		const testTimeoutMs = importCapMs(mb) + READ_CAP_MS + 20_000

		it.runIf(RUN)(
			`${mb}MB — inMemory`,
			async () => {
				await benchStorage(mb, 'inMemory')
				expect(RESULTS['getTree(root)']?.inMemory).toBeGreaterThan(0)
			},
			testTimeoutMs,
		)
		it.runIf(RUN)(
			`${mb}MB — local(IndexedDB)`,
			async () => {
				await benchStorage(mb, 'local')
				expect(RESULTS['getTree(root)']?.local).toBeGreaterThan(0)
			},
			testTimeoutMs,
		)
	}

	afterAll(() => {
		if (!RUN) return
		const lines = ['', '===== READ-COST: inMemory vs IndexedDB (last size) =====']
		lines.push('method                inMemory      local     local/inMemory')
		for (const [method, byStore] of Object.entries(RESULTS)) {
			const im = byStore.inMemory ?? 0
			const lo = byStore.local ?? 0
			const ratio = im > 0 ? (lo / im).toFixed(1) + 'x' : 'n/a'
			lines.push(
				`${method.padEnd(20)} ${im.toFixed(2).padStart(10)} ${lo.toFixed(2).padStart(10)}   ${ratio.padStart(8)}`,
			)
		}
		console.log(lines.join('\n'))
		console.log(`\n===== all [READ] lines =====\n${LINES.join('\n')}`)
	})
})
