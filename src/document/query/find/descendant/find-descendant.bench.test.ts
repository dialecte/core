import { afterAll, describe, expect, it } from 'vitest'

/**
 * findDescendants cost bench (browser, real IndexedDB via Dexie, and the in-memory store).
 *
 * Measures the two primitives the descendant finder chooses between — one `store.get` and one
 * whole-document `getByDocumentId` — and the finder itself in the shapes that matter: a large
 * flat collect under a section root, the same collect under the document root, a small collect
 * under a deep root, a many-tag collect (what the no-options form does) and a path collect.
 *
 * The per-record cost of the whole-document read divided by the cost of one `get` is the RATIO
 * the finder uses to decide when climbing has become dearer than reading the document once.
 *
 * Gated by `--mode bench` (or VITE_BENCH=1) so the normal suite / CI skips it. Run:
 *   VITE_BENCH=1 npx vitest run --project perf --mode bench --reporter=verbose --silent=false src/document/query/find/descendant/find-descendant.bench.test.ts
 *
 * Read the `[FIND]` lines from the browser console. Fixtures: `src/test/fixtures/data/stress-*.xml`
 * (generate them with `generate-stress-fixtures.ts`). Every block of a stress fixture is a `D`
 * branch of depth 11 and breadth 2: 1,024 `DDDDDDDDDDD_1` leaves ten levels under `D`.
 */
import { Project } from '@/project/project'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { PerfReport } from '@/perf'
import type { Store } from '@/store'
import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'

const SIZES = [5, 10]
const CAP_MS = 180_000

type Ref = { tagName: string; id: string }
type Storage = 'inMemory' | 'local'
type Row = {
	method: string
	ms: number
	get: number
	byTag: number
	byDoc: number
	count: number
	results: number
}

const LINES: string[] = []

const LEAF = 'DDDDDDDDDDD_1'
const DEEP = 'DDDDDDDD_1'
const ALL_D_TAGS = Array.from({ length: 11 }, (_, depth) => [
	`${'D'.repeat(depth + 2)}_1`,
	`${'D'.repeat(depth + 2)}_2`,
]).flat()

function fetchText(url: URL): Promise<string> {
	return fetch(url).then((res) => {
		if (!res.ok) throw new Error(`fixture missing (${res.status}) at ${url} — generate it first`)
		return res.text()
	})
}

const stressUrl = (mb: number): URL =>
	new URL(`../../../../test/fixtures/data/stress-${mb}mb.xml`, import.meta.url)

function withCap<T>(label: string, p: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout>
	const cap = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`CAP ${CAP_MS / 1000}s: ${label}`)), CAP_MS)
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
	await project.open(`find-${storage}-${crypto.randomUUID()}`)
	performance.clearMarks()
	performance.clearMeasures()
	const imp = await project.importFile(new File([xml], 'find.xml', { type: 'text/xml' }), {
		useCustomRecordsIds: false,
	})
	const doc = project.openDocument(imp.documentId)
	return { project, doc }
}

function countResults(result: unknown): number {
	if (Array.isArray(result)) return result.length
	if (result && typeof result === 'object') {
		return Object.values(result as Record<string, unknown[]>).reduce(
			(sum, group) => sum + (Array.isArray(group) ? group.length : 0),
			0,
		)
	}
	return 0
}

async function measure(
	doc: ReturnType<Project<AnyDialecteConfig>['openDocument']>,
	method: string,
	fn: () => Promise<unknown>,
	repeat = 1,
): Promise<Row> {
	doc.perf.reset()
	let last: unknown
	const t = performance.now()
	for (let i = 0; i < repeat; i++) last = await fn()
	const ms = (performance.now() - t) / repeat
	const r: PerfReport = doc.perf.report()
	const per = (name: string): number => Math.round((r[name]?.count ?? 0) / repeat)
	return {
		method,
		ms,
		get: per('core::store::get'),
		byTag: per('core::store::getByTagName'),
		byDoc: per('core::store::getByDocumentId'),
		count: per('core::store::count'),
		results: countResults(last),
	}
}

async function benchStorage(mb: number, storage: Storage): Promise<void> {
	const { project, doc } = await openImported(await fetchText(stressUrl(mb)), storage)
	try {
		const q = doc.query.any
		// The typed query takes the collect options; the stress tags are unknown to the test config,
		// so the refs and options are cast (the finder works on tag names at run time).
		const fd = (ref: Ref, options: unknown): Promise<unknown> =>
			doc.query.findDescendants(ref as never, options as never) as Promise<unknown>
		const [rootRec] = await q.getRecordsByTagName('Root')
		const [blockRec] = await q.getRecordsByTagName('D')
		const deepRecs = await q.getRecordsByTagName(DEEP)
		const leafRecs = await q.getRecordsByTagName(LEAF)
		const rootRef: Ref = { tagName: rootRec.tagName, id: rootRec.id }
		const blockRef: Ref = { tagName: blockRec.tagName, id: blockRec.id }
		const deepRef: Ref = { tagName: deepRecs[0].tagName, id: deepRecs[0].id }
		const sampleRefs: Ref[] = leafRecs
			.slice(0, 200)
			.map((r: Ref) => ({ tagName: r.tagName, id: r.id }))

		// The two primitives the finder chooses between, timed on the store itself: one by-id read
		// and one whole-document read. Their ratio per record is DOCUMENT_READ_COST_PER_RECORD.
		const store = (project as unknown as { store: Store }).store
		const size = await store.count(doc.documentId)
		const t0 = performance.now()
		for (const ref of sampleRefs) await store.get(ref.id, doc.documentId)
		const getMs = (performance.now() - t0) / sampleRefs.length
		const t1 = performance.now()
		await store.getByDocumentId(doc.documentId)
		const documentMs = performance.now() - t1
		const t2 = performance.now()
		await store.count(doc.documentId)
		const countMs = performance.now() - t2
		const ratioLine =
			`[RATIO] ${mb}MB ${storage.padEnd(8)} records ${size}  get ${getMs.toFixed(4)} ms  ` +
			`getByDocumentId ${documentMs.toFixed(1)} ms  count ${countMs.toFixed(2)} ms  ` +
			`per-record/get = 1/${(getMs / (documentMs / size)).toFixed(1)}`
		LINES.push(ratioLine)
		console.log(ratioLine)

		const rows: Row[] = []
		rows.push(
			await measure(doc, 'get x200', async () => {
				for (const ref of sampleRefs) await q.getRecord(ref)
			}),
		)
		rows.push(await measure(doc, 'getTree(root)', () => q.getTree(rootRef)))
		rows.push(await measure(doc, 'fd(D, leaf)', () => fd(blockRef, { collect: LEAF })))
		rows.push(await measure(doc, 'fd(Root, leaf)', () => fd(rootRef, { collect: LEAF })))
		rows.push(await measure(doc, 'fd(deep, leaf)', () => fd(deepRef, { collect: LEAF }), 5))
		rows.push(await measure(doc, 'fd(D, 22 tags)', () => fd(blockRef, { collect: ALL_D_TAGS })))
		rows.push(
			await measure(doc, 'fd(D, path)', () =>
				fd(blockRef, { collect: { DDDDD_1: { [LEAF]: true } } }),
			),
		)

		for (const row of rows) {
			const line =
				`[FIND] ${mb}MB ${storage.padEnd(8)} ${row.method.padEnd(16)} ` +
				`${row.ms.toFixed(1).padStart(9)} ms  get ${String(row.get).padStart(6)}  ` +
				`byTag ${String(row.byTag).padStart(3)}  byDoc ${row.byDoc}  count ${row.count}  ` +
				`results ${String(row.results).padStart(5)}`
			LINES.push(line)
			console.log(line)
		}
	} finally {
		await project.destroy()
	}
}

describe('findDescendants cost bench — inMemory vs IndexedDB (browser)', () => {
	for (const mb of SIZES) {
		it.runIf(RUN)(
			`${mb}MB — inMemory`,
			async () => {
				await benchStorage(mb, 'inMemory')
				expect(LINES.length).toBeGreaterThan(0)
			},
			CAP_MS + 20_000,
		)
		it.runIf(RUN)(
			`${mb}MB — local(IndexedDB)`,
			async () => {
				await withCap(`local ${mb}MB`, benchStorage(mb, 'local'))
				expect(LINES.length).toBeGreaterThan(0)
			},
			CAP_MS + 20_000,
		)
	}

	afterAll(() => {
		if (!RUN) return
		console.log(`\n===== all [FIND] lines =====\n${LINES.join('\n')}`)
	})
})
