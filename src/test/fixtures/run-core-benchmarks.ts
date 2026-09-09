/**
 * Core method benchmark harness — runs every fixture size in sequence and times each
 * core method against it, so the numbers scale with node count (~21K nodes/MB).
 *
 * "Grows with the API" — not by auto-calling unknown methods (reflection can't invent
 * valid arguments), but by AUTO-DETECTING them: it reflects the live `query` /
 * `transaction` prototypes and fails if a public method is neither in {@link BENCHMARKS}
 * nor {@link SKIP}. Add a core method → this harness forces you to add a benchmark row
 * (or skip it explicitly). That is the enforceable version of "the test grows alone".
 *
 * Runs against the BUILT dist (self-referencing `@dialecte/core`), so rebuild core
 * first (`npm run build`) — measuring a stale build is worse than not measuring.
 * Uses the in-memory store to isolate method cost from IndexedDB.
 *
 *   npm run build && npx tsx src/test/fixtures/run-core-benchmarks.ts          # 5/10/50 MB
 *   npx tsx src/test/fixtures/run-core-benchmarks.ts 5 100                      # only those
 *   node --max-old-space-size=8192 --import tsx src/test/fixtures/run-core-benchmarks.ts 200
 *
 * Prerequisite: generate the fixtures first (`generate-stress-fixtures.ts`).
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The harness intentionally measures the BUILT dist (rebuild before a run), so it
// self-imports by package name rather than the `@/*` source alias.
/* eslint-disable no-restricted-imports */
import { Project } from '@dialecte/core'
import { TEST_DIALECTE_CONFIG } from '@dialecte/core/test'

import type { Document } from '@dialecte/core'
/* eslint-enable no-restricted-imports */

const DEFAULT_SIZES_MB = [5, 10, 50, 100, 200, 500]

/**
 * Wall-time ceiling per fixture — a dev-harness guard, NOT the product SLA. If a fixture
 * blows past its budget the run fails fast instead of hanging (the point of the harness is
 * to expose an O(N²) regression, not to wait it out). Budgets are generous headroom over
 * today's linear-ish phases; tighten them as import perf improves so a regression trips.
 * Override any size with `BENCH_TIMEOUT_MS` (applies a single flat ceiling to all sizes).
 */
const TIMEOUT_MS: Record<number, number> = {
	5: 15_000,
	10: 20_000,
	50: 60_000,
	100: 90_000,
	200: 150_000,
	500: 180_000,
}
const DEFAULT_TIMEOUT_MS = 180_000

/** Reject if `work` outlives `ms`; the harness then exits non-zero (see {@link main}). */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>
	const guard = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} exceeded ${(ms / 1000).toFixed(0)}s budget — failing fast`)),
			ms,
		)
	})
	return Promise.race([work, guard]).finally(() => clearTimeout(timer)) as Promise<T>
}

/** Live handles a benchmark reads from, prepared once per fixture. */
type BenchContext = {
	doc: Document<typeof TEST_DIALECTE_CONFIG>
	rootRef: { tagName: string; id: string }
	sampleRef: { tagName: string; id: string }
	sampleTree: unknown
}

type Benchmark = {
	name: string
	/** Names of the core methods this row exercises (for the coverage guard). */
	covers: string[]
	run: (ctx: BenchContext) => Promise<unknown>
}

/**
 * Method names that are intentionally NOT benchmarked (not perf-relevant, or covered by
 * a wrapper): lifecycle, cache clearing, snapshot, the untyped `.any` namespace, etc.
 */
const SKIP = new Set<string>([
	'constructor',
	'commit',
	'clearStagedOperations',
	'clearRecordCache',
	'getOperations',
	'getStagedOperations',
	'withAllExtensions',
	'getDocumentInfo',
	'getSnapshot',
	'getRoot',
	'getRecord',
	'getRecords',
	'getChild',
	'ensureChild',
	'findAncestors',
])

const BENCHMARKS: Benchmark[] = [
	{
		name: 'getRecordsByTagName',
		covers: ['getRecordsByTagName'],
		run: ({ doc }) => doc.query.any.getRecordsByTagName('DDD_1'),
	},
	{
		name: 'getChildren',
		covers: ['getChildren'],
		run: ({ doc, rootRef }) => doc.query.any.getChildren(rootRef, 'D'),
	},
	{
		name: 'getAttributes',
		covers: ['getAttribute', 'getAttributes'],
		run: async ({ doc, sampleRef }) => {
			await doc.query.any.getAttribute(sampleRef, { name: 'aDDD_1' })
			return doc.query.any.getAttributes(sampleRef)
		},
	},
	{
		name: 'getTree(root)',
		covers: ['getTree'],
		run: ({ doc, rootRef }) => doc.query.any.getTree(rootRef),
	},
	{
		name: 'findDescendants(root)',
		covers: ['findDescendants'],
		run: ({ doc, rootRef }) => doc.query.any.findDescendants(rootRef),
	},
	{
		name: 'findByAttributes',
		covers: ['findByAttributes'],
		run: ({ doc }) =>
			doc.query.any.findByAttributes({ tagName: 'DDD_1', attributes: { aDDD_1: 'x' } }),
	},
	{
		name: 'deepClone(whole doc) + commit',
		covers: ['deepClone', 'addChild'],
		run: ({ doc, rootRef, sampleTree }) =>
			doc.transaction(async (tx) => {
				await tx.any.deepClone(rootRef, sampleTree as never)
			}),
	},
	{
		name: 'update + delete + commit',
		covers: ['update', 'delete'],
		run: ({ doc, sampleRef }) =>
			doc.transaction(async (tx) => {
				await tx.any.update(sampleRef, { attributes: { bDDD_1: 'z' } })
				await tx.any.delete(sampleRef)
			}),
	},
]

/** Own function-property names up the prototype chain (excludes Object.prototype). */
function methodNames(instance: object): Set<string> {
	const names = new Set<string>()
	let proto = Object.getPrototypeOf(instance)
	while (proto && proto !== Object.prototype) {
		for (const key of Object.getOwnPropertyNames(proto)) {
			const desc = Object.getOwnPropertyDescriptor(proto, key)
			if (desc && typeof desc.value === 'function') names.add(key)
		}
		proto = Object.getPrototypeOf(proto)
	}
	return names
}

/** Fail loudly if a public query/transaction method is neither benchmarked nor skipped. */
async function assertCoverage(doc: Document<typeof TEST_DIALECTE_CONFIG>): Promise<void> {
	const covered = new Set(BENCHMARKS.flatMap((b) => b.covers))
	const surface = new Set(methodNames(doc.query))
	// Empty transaction: capture the tx prototype surface, commits nothing.
	await doc.transaction(async (tx) => {
		for (const name of methodNames(tx)) surface.add(name)
	})

	const uncovered = [...surface].filter(
		(name) => !covered.has(name) && !SKIP.has(name) && !name.startsWith('_'),
	)
	if (uncovered.length > 0) {
		throw new Error(
			`Core API grew — ${uncovered.length} method(s) are neither benchmarked nor skipped:\n` +
				uncovered.map((n) => `  • ${n}`).join('\n') +
				`\nAdd a row to BENCHMARKS or an entry to SKIP in run-core-benchmarks.ts.`,
		)
	}
}

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
	}).open(`bench-${crypto.randomUUID()}`)

	// Clear the shared User-Timing timeline so this fixture's spans aren't summed with the
	// previous size's (a fresh Project keeps its own counters, but the timeline is global).
	performance.clearMarks()
	performance.clearMeasures()

	const start = performance.now()
	const [imported] = await project.import([new File([xml], 'bench.xml', { type: 'text/xml' })], {
		useCustomRecordsIds: false,
	})
	const importMs = performance.now() - start
	const doc = project.openDocument(imported.documentId)
	return { project, doc, importMs }
}

async function benchmarkFixture(mb: number, dataDir: string): Promise<void> {
	const path = join(dataDir, `stress-${mb}mb.xml`)
	const xml = await readFile(path, 'utf8')

	const { project, doc, importMs } = await importFixture(xml)
	try {
		if (mb === DEFAULT_SIZES_MB[0]) await assertCoverage(doc)

		const [rootRecord] = await doc.query.any.getRecordsByTagName('Root')
		const [sampleRecord] = await doc.query.any.getRecordsByTagName('DDD_1')
		const rootRef = { tagName: rootRecord.tagName, id: rootRecord.id }
		const sampleRef = { tagName: sampleRecord.tagName, id: sampleRecord.id }
		// Whole-document tree — the deepClone benchmark clones this (max node count).
		const sampleTree = await doc.query.any.getTree(rootRef)

		console.log(`\n=== ${mb} MB ===  import ${importMs.toFixed(0)} ms`)
		for (const bench of BENCHMARKS) {
			const start = performance.now()
			await bench.run({ doc, rootRef, sampleRef, sampleTree })
			const ms = performance.now() - start
			console.log(`  ${bench.name.padEnd(32)} ${ms.toFixed(1)} ms`)
		}

		const report = doc.perf.report()
		const importSpan = report['core::import']
		if (importSpan) {
			console.log(`  import phases: total ${importSpan.totalMs.toFixed(0)} ms`)
			for (const name of [
				'core::import::registerDocument',
				'core::import::read',
				'core::import::bufferAppend',
				'core::import::decode',
				'core::import::sax',
				'core::import::onOpenTag',
				'core::import::onText',
				'core::import::onCloseTag',
				'core::import::onCloseTag::batchCopy',
				'core::import::onCloseTag::standardize',
				'core::import::onCloseTag::beforeHook',
				'core::import::onCloseTag::reconcileChildren',
				'core::import::resolveChildren',
				'core::store::bulkWrite',
			]) {
				const s = report[name]
				if (s) console.log(`    ${name.padEnd(44)} ${s.totalMs.toFixed(0)} ms (${s.calls} calls)`)
			}
		}
		const commit = report['core::commit']
		if (commit) {
			const storeCommit = report['core::store::commit']
			console.log(
				`  commit: total ${commit.totalMs.toFixed(1)} ms — store::commit ${storeCommit?.totalMs.toFixed(1) ?? 'n/a'} ms`,
			)
		}
		const deepClone = report['core::deepClone']
		const countNodes = report['core::deepClone::countNodes']
		if (deepClone) {
			const pct = countNodes ? ((countNodes.totalMs / deepClone.totalMs) * 100).toFixed(1) : 'n/a'
			console.log(
				`  perf: deepClone ${deepClone.totalMs.toFixed(1)} ms — countNodes ${countNodes?.totalMs.toFixed(1) ?? 'n/a'} ms (${pct}%)`,
			)
		}
		// Round-trip counters — if these grow super-linearly with node count, the cost is
		// round-trip-bound (an O(N²) lookup), not per-call CPU.
		const counters = Object.entries(report)
			.filter(([, v]) => v.count !== undefined)
			.sort(([, a], [, b]) => (b.count ?? 0) - (a.count ?? 0))
		if (counters.length > 0) {
			console.log('  counts:')
			for (const [name, v] of counters) {
				console.log(`    ${name.padEnd(34)} ${(v.count ?? 0).toLocaleString()}`)
			}
		}
	} finally {
		await project.destroy()
	}
}

async function main(): Promise<void> {
	const here = dirname(fileURLToPath(import.meta.url))
	const dataDir = join(here, 'data')
	const argSizes = process.argv
		.slice(2)
		.map(Number)
		.filter((n) => Number.isFinite(n) && n > 0)
	const sizes = argSizes.length > 0 ? argSizes : DEFAULT_SIZES_MB

	const flatOverride = Number(process.env.BENCH_TIMEOUT_MS)
	const hasOverride = Number.isFinite(flatOverride) && flatOverride > 0

	for (const mb of sizes) {
		const budget = hasOverride ? flatOverride : (TIMEOUT_MS[mb] ?? DEFAULT_TIMEOUT_MS)
		try {
			await withTimeout(benchmarkFixture(mb, dataDir), budget, `${mb} MB fixture`)
		} catch (err) {
			// Per-fixture guard: a timeout/OOM on one size must not skip the remaining sizes.
			console.log(`\n=== ${mb} MB ===  FAILED: ${err instanceof Error ? err.message : String(err)}`)
		}
	}
}

main()
	.then(() => process.exit(0)) // a timed-out fixture leaks a running import; force a clean exit
	.catch((err) => {
		console.error(err)
		process.exit(1)
	})
