/**
 * Core method AUDIT harness — Phase 0 of the read/write performance work.
 *
 * Goal: one per-method ledger. For EVERY public Query/Transaction method it records,
 * across fixture sizes: wall time, the store round-trips it issued (`core::store::get` /
 * `getByTagName`), cache hit/miss, and — at the end — the empirical scaling exponent `k`
 * (log-log fit of ms vs node count). `k ≈ 1` linear, `k > 1.3` super-linear (the O(N²)
 * smell), `k ≈ 0` constant.
 *
 * Reads run on the pristine imported doc. Writes are measured via `prepare()` +
 * `discard()`, so the STAGING cost (where the staged-op scan lives) is isolated and the
 * document stays pristine between methods — no re-import per method.
 *
 * In-memory store only: this isolates ALGORITHMIC cost from IndexedDB. Real store cost is
 * measured separately in the browser bench (`idb-read-cost.bench.test.ts`).
 *
 * Runs against the vite-built dist (self-imports `@dialecte/core`). The full `npm run build`
 * may fail type-check on unrelated WIP code; build the bundle directly instead:
 *   npx vite build && npx tsx src/test/fixtures/scripts/audit-core-methods.ts            # 5/10/20/50/100 MB
 *   npx vite build && npx tsx src/test/fixtures/scripts/audit-core-methods.ts 5 50        # only those
 *   node --max-old-space-size=8192 --import tsx src/test/fixtures/scripts/audit-core-methods.ts 200
 *
 * Prerequisite: generate the fixtures first (`generate-stress-fixtures.ts`).
 * Writes a machine-readable ledger to `.tmp/core-method-audit.json`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* eslint-disable no-restricted-imports */
import { Project } from '@dialecte/core'
import { TEST_DIALECTE_CONFIG } from '@dialecte/core/test'

import type { Document } from '@dialecte/core'
import type { PerfReport } from '@dialecte/core'
/* eslint-enable no-restricted-imports */

const DEFAULT_SIZES_MB = [5, 10, 20, 50, 100]

/** Perf counters attributed per method (keys as they appear in `perf.report()`). */
const COUNTER_KEYS = [
	'core::store::get',
	'core::store::getByTagName',
	'core::query::getRecord.cacheHit',
	'core::query::getRecord.miss',
	'core::store::commit',
] as const

type Ref = { tagName: string; id: string }

type BenchCtx = {
	doc: Document<typeof TEST_DIALECTE_CONFIG>
	rootRef: Ref
	sampleRef: Ref
	childTagUnderRoot: string
	sampleChildTag: string
	batchRefs: Ref[]
	sampleTree: unknown
	bigSubtreeRef: Ref
}

type MethodDef = {
	name: string
	kind: 'read' | 'write'
	/** Repeat count to lift sub-millisecond methods above timer noise (default 1). */
	repeat?: number
	run: (ctx: BenchCtx) => Promise<unknown>
}

/** Cheap O(1)-ish methods: repeat to average out timer noise. */
const CHEAP = 50

/** Read methods run on the pristine doc; they never mutate. */
const READ_METHODS: MethodDef[] = [
	{ name: 'getRoot', kind: 'read', run: ({ doc }) => doc.query.getRoot() },
	{
		name: 'getRecord',
		kind: 'read',
		repeat: CHEAP,
		run: ({ doc, sampleRef }) => doc.query.any.getRecord(sampleRef),
	},
	{
		name: 'getRecords(batch)',
		kind: 'read',
		run: ({ doc, batchRefs }) => doc.query.any.getRecords(batchRefs),
	},
	{
		name: 'getRecordsByTagName',
		kind: 'read',
		run: ({ doc, sampleChildTag }) => doc.query.any.getRecordsByTagName(sampleChildTag),
	},
	{
		name: 'getChild',
		kind: 'read',
		repeat: CHEAP,
		run: ({ doc, rootRef, childTagUnderRoot }) =>
			doc.query.any.getChild(rootRef, childTagUnderRoot),
	},
	{
		name: 'getChildren',
		kind: 'read',
		repeat: CHEAP,
		run: ({ doc, rootRef, childTagUnderRoot }) =>
			doc.query.any.getChildren(rootRef, childTagUnderRoot),
	},
	{
		name: 'getAttribute',
		kind: 'read',
		repeat: CHEAP,
		run: ({ doc, sampleRef }) => doc.query.any.getAttribute(sampleRef, { name: 'aDDD_1' }),
	},
	{
		name: 'getAttributes',
		kind: 'read',
		repeat: CHEAP,
		run: ({ doc, sampleRef }) => doc.query.any.getAttributes(sampleRef),
	},
	{
		name: 'getTree(root)',
		kind: 'read',
		run: ({ doc, rootRef }) => doc.query.any.getTree(rootRef),
	},
	{
		name: 'findDescendants(root)',
		kind: 'read',
		run: ({ doc, rootRef }) => doc.query.any.findDescendants(rootRef),
	},
	{
		name: 'findAncestors(leaf)',
		kind: 'read',
		repeat: CHEAP,
		run: ({ doc, sampleRef }) => doc.query.any.findAncestors(sampleRef),
	},
	{
		name: 'findByAttributes',
		kind: 'read',
		run: ({ doc, sampleChildTag }) =>
			doc.query.any.findByAttributes({ tagName: sampleChildTag, attributes: { aDDD_1: 'x' } }),
	},
	{ name: 'getSnapshot', kind: 'read', run: ({ doc }) => doc.query.any.getSnapshot() },
]

/** Write methods measured via prepare()+discard() to isolate STAGING and keep the doc pristine. */
const WRITE_METHODS: MethodDef[] = [
	{
		name: 'addChild',
		kind: 'write',
		repeat: CHEAP,
		run: ({ doc, rootRef, childTagUnderRoot }) =>
			stageAndDiscard(doc, (tx) =>
				tx.any.addChild(rootRef, { tagName: childTagUnderRoot, attributes: {} }),
			),
	},
	{
		name: 'ensureChild',
		kind: 'write',
		repeat: CHEAP,
		run: ({ doc, rootRef, childTagUnderRoot }) =>
			stageAndDiscard(doc, (tx) =>
				tx.any.ensureChild(rootRef, { tagName: childTagUnderRoot, attributes: {} }),
			),
	},
	{
		name: 'update',
		kind: 'write',
		repeat: CHEAP,
		run: ({ doc, sampleRef }) =>
			stageAndDiscard(doc, (tx) => tx.any.update(sampleRef, { attributes: { bDDD_1: 'z' } })),
	},
	{
		name: 'delete(subtree)',
		kind: 'write',
		run: ({ doc, bigSubtreeRef }) => stageAndDiscard(doc, (tx) => tx.any.delete(bigSubtreeRef)),
	},
	{
		name: 'deepClone(whole doc)',
		kind: 'write',
		run: ({ doc, rootRef, sampleTree }) =>
			stageAndDiscard(doc, (tx) => tx.any.deepClone(rootRef, sampleTree as never)),
	},
]

const METHODS = [...READ_METHODS, ...WRITE_METHODS]

type PrepareFn = Parameters<Document<typeof TEST_DIALECTE_CONFIG>['prepare']>[0]
type TxArg = Parameters<PrepareFn>[0]

/** Run a staging callback inside prepare(), then discard so the document stays pristine. */
async function stageAndDiscard(
	doc: Document<typeof TEST_DIALECTE_CONFIG>,
	fn: (tx: TxArg) => Promise<unknown>,
): Promise<void> {
	const prepared = await doc.prepare(fn as PrepareFn)
	prepared.discard()
}

type Sample = { mb: number; nodeCount: number; ms: number; counts: Record<string, number> }
type Ledger = Record<string, { kind: 'read' | 'write'; samples: Sample[] }>

async function importFixture(xml: string): Promise<{
	project: Project<typeof TEST_DIALECTE_CONFIG>
	doc: Document<typeof TEST_DIALECTE_CONFIG>
	importMs: number
}> {
	const project = await new Project<typeof TEST_DIALECTE_CONFIG>({
		configs: { default: TEST_DIALECTE_CONFIG },
		defaultConfigKey: 'default',
		storage: { type: 'inMemory' },
		dev: { perf: true },
	}).open(`audit-${crypto.randomUUID()}`)

	performance.clearMarks()
	performance.clearMeasures()

	const start = performance.now()
	const [imported] = await project.import([new File([xml], 'audit.xml', { type: 'text/xml' })], {
		useCustomRecordsIds: false,
	})
	const importMs = performance.now() - start
	const doc = project.openDocument(imported.documentId)
	return { project, doc, importMs }
}

async function buildContext(doc: Document<typeof TEST_DIALECTE_CONFIG>): Promise<{
	ctx: BenchCtx
	nodeCount: number
}> {
	const [rootRecord] = await doc.query.any.getRecordsByTagName('Root')
	const [sampleRecord] = await doc.query.any.getRecordsByTagName('DDD_1')
	const rootRef = { tagName: rootRecord.tagName, id: rootRecord.id }
	const sampleRef = { tagName: sampleRecord.tagName, id: sampleRecord.id }

	const rootChildren = await doc.query.any.getChildren(rootRef, 'D')
	const bigSubtreeRef = { tagName: rootChildren[0].tagName, id: rootChildren[0].id }

	// A batch of refs for getRecords — up to 2000 DDD_1 nodes.
	const ddd = await doc.query.any.getRecordsByTagName('DDD_1')
	const batchRefs = ddd.slice(0, 2000).map((r) => ({ tagName: r.tagName, id: r.id }))

	// getTree returns a TreeRecord; count its nodes directly (computed OUTSIDE any measured
	// section). Robust to getTree now using a single bulk read (no per-node store.get).
	doc.perf.reset()
	const sampleTree = await doc.query.any.getTree(rootRef)
	const nodeCount = countTreeNodes(sampleTree)

	return {
		ctx: {
			doc,
			rootRef,
			sampleRef,
			childTagUnderRoot: 'D',
			sampleChildTag: 'DDD_1',
			batchRefs,
			sampleTree,
			bigSubtreeRef,
		},
		nodeCount,
	}
}

function captureCounts(report: PerfReport): Record<string, number> {
	const counts: Record<string, number> = {}
	for (const key of COUNTER_KEYS) counts[key] = report[key]?.count ?? 0
	return counts
}

/** Count every node in a getTree() result (root + all descendants). */
function countTreeNodes(node: unknown): number {
	if (!node || typeof node !== 'object') return 0
	const children = (node as { tree?: unknown[] }).tree
	if (!Array.isArray(children)) return 1
	let total = 1
	for (const child of children) total += countTreeNodes(child)
	return total
}

async function auditFixture(mb: number, dataDir: string, ledger: Ledger): Promise<void> {
	const path = join(dataDir, `stress-${mb}mb.xml`)
	const xml = await readFile(path, 'utf8')
	const { project, doc, importMs } = await importFixture(xml)
	try {
		const { ctx, nodeCount } = await buildContext(doc)
		console.log(
			`\n=== ${mb} MB ===  import ${importMs.toFixed(0)} ms — ${nodeCount.toLocaleString()} nodes`,
		)

		for (const method of METHODS) {
			const repeat = method.repeat ?? 1
			doc.perf.reset()
			const start = performance.now()
			for (let i = 0; i < repeat; i++) await method.run(ctx)
			const ms = (performance.now() - start) / repeat
			const raw = captureCounts(doc.perf.report())
			const counts: Record<string, number> = {}
			for (const key of COUNTER_KEYS) counts[key] = Math.round(raw[key] / repeat)
			ledger[method.name] ??= { kind: method.kind, samples: [] }
			ledger[method.name].samples.push({ mb, nodeCount, ms, counts })

			const g = counts['core::store::get']
			const t = counts['core::store::getByTagName']
			const nodesPerS = ms > 0 ? Math.round(nodeCount / (ms / 1000)) : 0
			console.log(
				`  ${method.name.padEnd(24)} ${ms.toFixed(3).padStart(10)} ms  ` +
					`store.get ${String(g).padStart(8)}  byTag ${String(t).padStart(6)}  ` +
					`${nodesPerS.toLocaleString()} nodes/s`,
			)
		}
	} finally {
		await project.destroy()
	}
}

/** Least-squares slope of log(ms) vs log(nodeCount) — the empirical scaling exponent. */
function scalingExponent(samples: Sample[]): number | null {
	const points = samples.filter((s) => s.ms > 0.05 && s.nodeCount > 0)
	if (points.length < 2) return null
	const xs = points.map((s) => Math.log(s.nodeCount))
	const ys = points.map((s) => Math.log(s.ms))
	const n = xs.length
	const sx = xs.reduce((a, b) => a + b, 0)
	const sy = ys.reduce((a, b) => a + b, 0)
	const sxx = xs.reduce((a, b) => a + b * b, 0)
	const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0)
	const denom = n * sxx - sx * sx
	if (denom === 0) return null
	return (n * sxy - sx * sy) / denom
}

function printSummary(ledger: Ledger): void {
	console.log('\n\n===== SCALING SUMMARY (sorted by exponent k) =====')
	console.log('method                    kind    k      ms@max   store.get@max  miss@max')
	const rows = Object.entries(ledger)
		.map(([name, { kind, samples }]) => {
			const last = samples[samples.length - 1]
			return {
				name,
				kind,
				k: scalingExponent(samples),
				msMax: last.ms,
				getMax: last.counts['core::store::get'],
				missMax: last.counts['core::query::getRecord.miss'],
			}
		})
		.sort((a, b) => (b.k ?? -1) - (a.k ?? -1))

	for (const r of rows) {
		const kStr = r.k === null ? '  n/a' : r.k.toFixed(2).padStart(5)
		console.log(
			`${r.name.padEnd(25)} ${r.kind.padEnd(6)} ${kStr}  ${r.msMax.toFixed(1).padStart(8)}  ` +
				`${String(r.getMax).padStart(12)}  ${String(r.missMax).padStart(8)}`,
		)
	}
	console.log('\nk ~1 linear · k >1.3 super-linear (O(N^2) smell) · k ~0 constant')
}

async function main(): Promise<void> {
	const here = dirname(fileURLToPath(import.meta.url))
	const dataDir = join(here, 'data')
	const argSizes = process.argv
		.slice(2)
		.map(Number)
		.filter((n) => Number.isFinite(n) && n > 0)
	const sizes = argSizes.length > 0 ? argSizes : DEFAULT_SIZES_MB

	const ledger: Ledger = {}
	for (const mb of sizes) {
		try {
			await auditFixture(mb, dataDir, ledger)
		} catch (err) {
			console.log(`\n=== ${mb} MB ===  FAILED: ${err instanceof Error ? err.message : String(err)}`)
		}
	}

	printSummary(ledger)

	const outDir = join(process.cwd(), '.tmp')
	await mkdir(outDir, { recursive: true })
	const outFile = join(outDir, 'core-method-audit.json')
	await writeFile(
		outFile,
		JSON.stringify({ generatedAt: new Date().toISOString(), sizes, ledger }, null, 2),
	)
	console.log(`\nLedger written to ${outFile}`)
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err)
		process.exit(1)
	})
