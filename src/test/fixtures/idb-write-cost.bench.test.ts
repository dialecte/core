import Dexie from 'dexie'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * IndexedDB WRITE-COST harness — attributes `bulkAdd` time to its cost drivers, which the
 * black-box `core::store::bulkWrite::add` span cannot. Parses a fixture ONCE into raw records
 * (no IndexedDB), then bulk-adds the SAME records into fresh Dexie tables under different index
 * schemas and batch sizes. Deltas isolate:
 *   (+scalar) − (id-only)     = the 4 scalar/compound indexes
 *   (+multiEntry) − (+scalar) = the 2 multiEntry `*children.*` indexes (drop candidate)
 *   across batchSize          = transaction/flush overhead (the sweep)
 * Wall-clock only (no perf timers), so nothing skews the tuning numbers. Gated by VITE_BENCH:
 *   VITE_BENCH=1 npx vitest run --mode bench src/test/fixtures/idb-write-cost.bench.test.ts
 */
import { buildDexieSchema } from '@/store/local/dexie-store'
import { TEST_DIALECTE_CONFIG } from '@/test'
import { parseXmlFile } from '@/xml'

import type { RecordSchema } from '@/store'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'

const ATTR_SIZE = 5 // 92K records — every index variant completes under the cap at this size
const TX_SWEEP_SIZE = 5 // id-only batchSize sweep (kept at 5MB; bigger sizes OOM the browser tab)
const TX_BATCHES = [2000, 10000, 50000] // no single-tx: one tx over the whole file OOMs the page
const FULL_SWEEP_BATCHES = [2000, 10000]
const DEFAULT_BATCH = 2000
const CAP_MS = 170_000
const LINES: string[] = []
// Progress: total variant runs = index variants (3) + id-only batches + full-schema batches.
const TOTAL_STEPS = 3 + TX_BATCHES.length + FULL_SWEEP_BATCHES.length
let stepNo = 0

const SCHEMAS: Record<string, RecordSchema> = {
	'id-only': { primaryKey: 'id', indexes: [], compoundIndexes: [], arrayIndexes: [] },
	'+scalar': {
		primaryKey: 'id',
		indexes: ['tagName', 'parent.id', 'parent.tagName'],
		compoundIndexes: [['id', 'tagName']],
		arrayIndexes: [],
	},
	'+multiEntry(full)': {
		primaryKey: 'id',
		indexes: ['tagName', 'parent.id', 'parent.tagName'],
		compoundIndexes: [['id', 'tagName']],
		arrayIndexes: ['children.id', 'children.tagName'],
	},
}

const stressUrl = (mb: number): URL => new URL(`./data/stress-${mb}mb.xml`, import.meta.url)

async function fetchText(url: URL): Promise<string> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`fixture missing (${res.status}) at ${url} — generate it first`)
	return res.text()
}

/** Parse a fixture into the raw record set, WITHOUT any IndexedDB write (capture store). */
async function parseRecords(xml: string): Promise<AnyRawRecord[]> {
	const all: AnyRawRecord[] = []
	const store = {
		bulkWrite: async (_documentId: string, ops: { creates?: AnyRawRecord[] }): Promise<void> => {
			if (ops.creates) all.push(...ops.creates)
		},
	} as unknown as Store
	await parseXmlFile({
		file: new File([xml], 'writecost.xml', { type: 'text/xml' }),
		documentId: 'writecost',
		store,
		config: CONFIG,
	})
	return all
}

/** Bulk-add records into a fresh Dexie table under `schema`, one rw transaction per batch. */
async function timeBulkAdd(
	records: AnyRawRecord[],
	schema: RecordSchema,
	batchSize: number,
): Promise<number> {
	const name = `writecost-${crypto.randomUUID()}`
	const db = new Dexie(name)
	db.version(1).stores({ rec: buildDexieSchema(schema) })
	await db.open()
	const table = db.table<AnyRawRecord>('rec')

	const step = batchSize > 0 ? batchSize : records.length // 0 → single transaction
	const start = performance.now()
	for (let i = 0; i < records.length; i += step) {
		const batch = records.slice(i, i + step)
		await db.transaction('rw', table, async () => {
			await table.bulkAdd(batch)
		})
	}
	const ms = performance.now() - start

	db.close()
	await Dexie.delete(name)
	return ms
}

function beginStep(label: string): void {
	stepNo++
	console.log(`[WRITE ${stepNo}/${TOTAL_STEPS}] running: ${label} ...`)
}

function writeLine(label: string, records: number, ms: number): void {
	const tag = `[WRITE ${stepNo}/${TOTAL_STEPS}]`
	if (ms < 0) {
		const s = `${tag} ${label}: CAPPED (> ${CAP_MS / 1000}s, ${records.toLocaleString()} recs)`
		LINES.push(s)
		console.log(s)
		return
	}
	const perSec = ms > 0 ? Math.round(records / (ms / 1000)) : 0
	const s = `${tag} ${label}: ${ms.toFixed(0)}ms  (${perSec.toLocaleString()} rec/s, ${records.toLocaleString()} recs)`
	LINES.push(s)
	console.log(s)
}

async function withCap<GenericResult>(
	what: string,
	p: Promise<GenericResult>,
): Promise<GenericResult> {
	let timer: ReturnType<typeof setTimeout>
	const cap = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`CAP ${CAP_MS / 1000}s: ${what}`)), CAP_MS)
	})
	try {
		return await Promise.race([p, cap])
	} finally {
		clearTimeout(timer!)
	}
}

/** Run one variant with an internal cap; returns ms, or -1 if it exceeded the cap. */
async function measure(
	records: AnyRawRecord[],
	schema: RecordSchema,
	batchSize: number,
): Promise<number> {
	try {
		return await withCap('write', timeBulkAdd(records, schema, batchSize))
	} catch {
		return -1
	}
}

const bsLabel = (bs: number): string => (bs === 0 ? 'single-tx' : `bs=${bs}`)

describe('IndexedDB write-cost — index + batchSize attribution (browser)', () => {
	// Index attribution: same records, id-only vs +scalar vs +multiEntry, fixed batchSize.
	it.runIf(RUN)(
		`index attribution ${ATTR_SIZE}MB (bs=${DEFAULT_BATCH})`,
		async () => {
			const records = await parseRecords(await fetchText(stressUrl(ATTR_SIZE)))
			for (const [name, schema] of Object.entries(SCHEMAS)) {
				const label = `${ATTR_SIZE}MB ${name} bs=${DEFAULT_BATCH}`
				beginStep(label)
				writeLine(label, records.length, await measure(records, schema, DEFAULT_BATCH))
			}
			expect(records.length).toBeGreaterThan(0)
		},
		CAP_MS * 4,
	)

	// Transaction-overhead isolation: id-only (no secondary index) across batch sizes and a
	// single transaction. If the floor drops a lot with bigger batches → commit-bound (tunable);
	// if it stays flat → structured-clone/put-bound (needs a different store).
	it.runIf(RUN)(
		`id-only transaction sweep ${TX_SWEEP_SIZE}MB`,
		async () => {
			const records = await parseRecords(await fetchText(stressUrl(TX_SWEEP_SIZE)))
			for (const bs of TX_BATCHES) {
				const label = `${TX_SWEEP_SIZE}MB id-only ${bsLabel(bs)}`
				beginStep(label)
				writeLine(label, records.length, await measure(records, SCHEMAS['id-only'], bs))
			}
			expect(records.length).toBeGreaterThan(0)
		},
		CAP_MS * 5,
	)

	// Full production schema across batch sizes — does batching help the indexed path?
	it.runIf(RUN)(
		`full-schema batch sweep ${ATTR_SIZE}MB`,
		async () => {
			const records = await parseRecords(await fetchText(stressUrl(ATTR_SIZE)))
			for (const bs of FULL_SWEEP_BATCHES) {
				const label = `${ATTR_SIZE}MB full ${bsLabel(bs)}`
				beginStep(label)
				writeLine(label, records.length, await measure(records, SCHEMAS['+multiEntry(full)'], bs))
			}
			expect(records.length).toBeGreaterThan(0)
		},
		CAP_MS * 4,
	)

	afterAll(() => {
		if (RUN) console.log(`\n===== write-cost summary =====\n${LINES.join('\n')}`)
	})
})
