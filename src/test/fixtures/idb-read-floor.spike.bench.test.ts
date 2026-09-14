import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Read-FLOOR spike (browser, real IndexedDB) — Phase 1a. Answers WHERE the IndexedDB read
 * floor is and whether it is improvable, BEFORE building depth-limiting / getMany.
 *
 * Each probe is its OWN test so vitest streams `✓ step (Xms)` live — you see which step runs
 * and how long each takes, instead of one buffered blob at the end.
 *
 * Gated by VITE_BENCH=1. Stream live (no file redirect), poll the terminal:
 *   VITE_BENCH=1 npx vitest run --mode bench --reporter=verbose \
 *     src/test/fixtures/idb-read-floor.spike.bench.test.ts
 */
import { Project } from '@/project/project'
import { recordTableName } from '@/store'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { Store } from '@/store'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'
// Start with 5 MB for a fast signal; add 10 to the array once the shape looks right.
const SIZES = [5]
const HOOK_TIMEOUT = 180_000
const STEP_TIMEOUT = 180_000

type Storage = 'inMemory' | 'local'
type RawTable = { bulkGet(keys: string[]): Promise<unknown[]> }

function fetchText(url: URL): Promise<string> {
	return fetch(url).then((res) => {
		if (!res.ok) throw new Error(`fixture missing (${res.status}) at ${url}`)
		return res.text()
	})
}
const stressUrl = (mb: number): URL => new URL(`./data/stress-${mb}mb.xml`, import.meta.url)

async function timed(label: string, fn: () => Promise<unknown>): Promise<number> {
	const t = performance.now()
	await fn()
	const ms = performance.now() - t
	console.log(`[FLOOR] ${label.padEnd(40)} ${ms.toFixed(1).padStart(10)} ms`)
	return ms
}

function sampleIds(rows: AnyRawRecord[], k: number): string[] {
	if (rows.length <= k) return rows.map((r) => r.id)
	const step = Math.floor(rows.length / k)
	const ids: string[] = []
	for (let i = 0; i < rows.length && ids.length < k; i += step) ids.push(rows[i].id)
	return ids
}

/**
 * Scoped BFS: fetch a subtree level-by-level (one getMany/bulkGet per level), stopping at
 * maxDepth. Returns the node count fetched. Round-trips = min(maxDepth, subtree height).
 */
async function scopedBfs(params: {
	store: Store
	table?: RawTable
	documentId: string
	root: AnyRawRecord
	maxDepth: number
}): Promise<number> {
	const { store, table, documentId, root, maxDepth } = params
	const byId = new Map<string, AnyRawRecord>([[root.id, root]])
	let frontier: AnyRawRecord[] = [root]
	for (let d = 0; d < maxDepth && frontier.length; d++) {
		const childIds = frontier.flatMap((r) => r.children.map((ch) => ch.id))
		if (!childIds.length) break
		const children = (
			table
				? await table.bulkGet(childIds)
				: await Promise.all(childIds.map((id) => store.get(id, documentId)))
		) as (AnyRawRecord | undefined)[]
		frontier = children.filter((r): r is AnyRawRecord => !!r)
		for (const r of frontier) byId.set(r.id, r)
	}
	return byId.size
}

/** One shared, mutable context per (size, storage) suite, filled step by step. */
type Ctx = {
	project?: Project<AnyDialecteConfig>
	doc?: ReturnType<Project<AnyDialecteConfig>['openDocument']>
	store?: Store
	table?: RawTable
	documentId?: string
	rows?: AnyRawRecord[]
}

function defineSuite(mb: number, storage: Storage): void {
	describe.runIf(RUN)(`${mb}MB — ${storage}`, () => {
		const c: Ctx = {}

		beforeAll(async () => {
			const project = new Project({
				configs: { default: CONFIG },
				defaultConfigKey: 'default',
				storage: storage === 'local' ? { type: 'local' } : { type: 'inMemory' },
				dev: { perf: false },
			})
			await project.open(`floor-${storage}-${crypto.randomUUID()}`)
			const xml = await fetchText(stressUrl(mb))
			await timed(`${mb}MB ${storage} import`, async () => {
				const [imp] = await project.import([new File([xml], 'f.xml')], {
					useCustomRecordsIds: false,
				})
				c.documentId = imp.documentId
			})
			c.project = project
			c.doc = project.openDocument(c.documentId!)
			c.store = (project as unknown as { store: Store }).store
			const db = (c.store as unknown as { db?: { table(n: string): RawTable } }).db
			c.table = db ? db.table(recordTableName(c.documentId!)) : undefined
		}, HOOK_TIMEOUT)

		afterAll(async () => {
			await c.project?.destroy()
		})

		it(
			'getByDocumentId (whole)',
			async () => {
				await timed(`${mb}MB ${storage} getByDocumentId`, async () => {
					c.rows = (await c.store!.getByDocumentId(c.documentId!)) as AnyRawRecord[]
				})
				console.log(`[FLOOR]   -> ${c.rows!.length.toLocaleString()} rows`)
				expect(c.rows!.length).toBeGreaterThan(0)
			},
			STEP_TIMEOUT,
		)

		// Isolated getSnapshot — runs BEFORE any whole-tree build, so no heap-pressure artifact.
		it(
			'getSnapshot as:tree [isolated]',
			async () => {
				await timed(`${mb}MB ${storage} getSnapshot tree`, () => c.doc!.query.any.getSnapshot())
			},
			STEP_TIMEOUT,
		)

		it(
			'getSnapshot as:xml [isolated]',
			async () => {
				await timed(`${mb}MB ${storage} getSnapshot xml`, () =>
					c.doc!.query.any.getSnapshot({ as: 'xml' }),
				)
			},
			STEP_TIMEOUT,
		)

		for (const k of [1000, 5000]) {
			it(
				`get x${k} sequential`,
				async () => {
					const ids = sampleIds(c.rows!, k)
					await timed(`${mb}MB ${storage} get x${k} seq`, async () => {
						for (const id of ids) await c.store!.get(id, c.documentId!)
					})
					expect(ids.length).toBeGreaterThan(0)
				},
				STEP_TIMEOUT,
			)

			it(
				`get x${k} parallel`,
				async () => {
					const ids = sampleIds(c.rows!, k)
					await timed(`${mb}MB ${storage} get x${k} par`, () =>
						Promise.all(ids.map((id) => c.store!.get(id, c.documentId!))),
					)
					expect(ids.length).toBeGreaterThan(0)
				},
				STEP_TIMEOUT,
			)

			it(
				`bulkGet x${k}`,
				async () => {
					if (!c.table) return
					const ids = sampleIds(c.rows!, k)
					await timed(`${mb}MB ${storage} bulkGet x${k}`, () => c.table!.bulkGet(ids))
				},
				STEP_TIMEOUT,
			)
		}

		it(
			'depth-1 (root + children)',
			async () => {
				const root = c.rows!.find((r) => r.parent === null) ?? c.rows![0]
				const childIds = root.children.map((ch) => ch.id)
				await timed(`${mb}MB ${storage} depth-1 (${childIds.length} children)`, () =>
					c.table
						? c.table.bulkGet(childIds)
						: Promise.all(childIds.map((id) => c.store!.get(id, c.documentId!))),
				)
				expect(childIds.length).toBeGreaterThanOrEqual(0)
			},
			STEP_TIMEOUT,
		)

		// --- Head-to-head: whole-tree assembly strategies (the real getTree cost) ---
		// Order matters: measure the LEAN fix first (clean heap), then the heavy current
		// getTree, then getSnapshot last (its toTree floods the heap).

		it(
			'getByDocumentId + map-assemble (lean) [FULL PATH]',
			async () => {
				await timed(`${mb}MB ${storage} bulk+assemble`, async () => {
					const rows = (await c.store!.getByDocumentId(c.documentId!)) as AnyRawRecord[]
					const byId = new Map(rows.map((r) => [r.id, { record: r, children: [] as unknown[] }]))
					let rootNode: unknown
					for (const r of rows) {
						const node = byId.get(r.id)!
						if (r.parent === null) rootNode = node
						else byId.get(r.parent.id)?.children.push(node)
					}
					return rootNode
				})
			},
			STEP_TIMEOUT,
		)

		// --- The shipped getTree API (new impl): full vs depth-1 ---

		it(
			'getTree(root) [NEW]',
			async () => {
				const root = c.rows!.find((r) => r.parent === null) ?? c.rows![0]
				await timed(`${mb}MB ${storage} getTree full [new]`, () =>
					c.doc!.query.any.getTree({ tagName: root.tagName, id: root.id }),
				)
			},
			STEP_TIMEOUT,
		)

		it(
			'getTree(root,{depth:1}) [NEW]',
			async () => {
				const root = c.rows!.find((r) => r.parent === null) ?? c.rows![0]
				await timed(`${mb}MB ${storage} getTree depth1 [new]`, () =>
					c.doc!.query.any.getTree({ tagName: root.tagName, id: root.id }, { depth: 1 }),
				)
			},
			STEP_TIMEOUT,
		)

		// --- Scoped path: level-by-level getMany BFS (the depth-limited / lazy path) ---

		for (const depth of [2, 3]) {
			it(
				`scoped BFS depth-${depth} (from root)`,
				async () => {
					const root = c.rows!.find((r) => r.parent === null) ?? c.rows![0]
					let n = 0
					await timed(`${mb}MB ${storage} scoped BFS d${depth}`, async () => {
						n = await scopedBfs({
							store: c.store!,
							table: c.table,
							documentId: c.documentId!,
							root,
							maxDepth: depth,
						})
					})
					console.log(`[FLOOR]   -> ${n.toLocaleString()} nodes`)
				},
				STEP_TIMEOUT,
			)
		}

		it(
			'scoped BFS FULL (from root) [ONE-PATH cost]',
			async () => {
				const root = c.rows!.find((r) => r.parent === null) ?? c.rows![0]
				let n = 0
				await timed(`${mb}MB ${storage} scoped BFS full(root)`, async () => {
					n = await scopedBfs({
						store: c.store!,
						table: c.table,
						documentId: c.documentId!,
						root,
						maxDepth: Infinity,
					})
				})
				console.log(`[FLOOR]   -> ${n.toLocaleString()} nodes (vs whole-doc bulk+assemble)`)
			},
			STEP_TIMEOUT,
		)

		it(
			'scoped BFS FULL (from one D subtree) [CROSSOVER]',
			async () => {
				const root = c.rows!.find((r) => r.parent === null) ?? c.rows![0]
				const dRef = root.children.find((ch) => ch.tagName === 'D') ?? root.children[0]
				const dRoot = c.rows!.find((r) => r.id === dRef.id)!
				let n = 0
				await timed(`${mb}MB ${storage} scoped BFS full(D subtree)`, async () => {
					n = await scopedBfs({
						store: c.store!,
						table: c.table,
						documentId: c.documentId!,
						root: dRoot,
						maxDepth: Infinity,
					})
				})
				console.log(
					`[FLOOR]   -> ${n.toLocaleString()} nodes in subtree (whole-doc reads all ${c.rows!.length.toLocaleString()})`,
				)
			},
			STEP_TIMEOUT,
		)
	})
}

for (const mb of SIZES) {
	defineSuite(mb, 'inMemory')
	defineSuite(mb, 'local')
}
