import { makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { seqOf, untilPairsReady } from './attribute-index.fixtures'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterAll, describe, expect, it } from 'vitest'

import type { SqliteEngine } from './engine.types'
import type { AnyRawRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** Records of the indexed tag `A` and of the other tag `B` in the synthetic document. */
const INDEXED_RECORDS = 20_000
const OTHER_RECORDS = 40_000

/** Warm lookups per path; the bench takes their median. */
const WARM_RUNS = 21

/** Records rewritten per write-cost run. */
const WRITTEN_RECORDS = 5_000

/** A lookup of one value from a ready pair answers one record: an index read stays far under a tag read. */
const INDEXED_LOOKUP_BUDGET_MS = 1

/** The bench's setup ceiling (60,000 records written, two pairs built). */
const BENCH_TIMEOUT_MS = 5 * 60_000

// The SQLite engine's attribute lookup on a synthetic document of 60,000 records, in Node (wasm): one value looked up
// by today's path (tag read, then filtered in JS), by the SQL filter (a pair not built yet), and from the index; the
// file's size before and after two pairs are built; the cost of a write of records of a tag with pairs and of one
// without. Runs under `--mode bench` (or VITE_BENCH=1): `npm run test:perf:node`.
const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'

const DOCUMENT_ID = 'doc-1'

const opened: Database[] = []

function median(values: number[]): number {
	const sorted = [...values].sort((left, right) => left - right)
	return sorted[Math.floor(sorted.length / 2)]!
}

/** The median of warm runs of `work`, after one cold run, in ms. */
async function timed(work: () => Promise<unknown>): Promise<number> {
	await work()
	const durations: number[] = []
	for (let run = 0; run < WARM_RUNS; run++) {
		const startedAt = performance.now()
		await work()
		durations.push(performance.now() - startedAt)
	}
	return median(durations)
}

function fileBytesOf(params: { db: Database }): number {
	const { db } = params
	return Number(db.selectValue('PRAGMA page_count')) * Number(db.selectValue('PRAGMA page_size'))
}

/** A record of the synthetic document: a unique uuid, one of 100 refs, a name. */
function syntheticRecord(params: { index: number; tagName: string }): AnyRawRecord {
	const { index, tagName } = params
	return makeRecord({
		id: `${tagName}-${String(index).padStart(6, '0')}`,
		tagName,
		attributes: [
			{ name: 'uuid', value: crypto.randomUUID() },
			{ name: 'ref', value: `ref-${index % 100}` },
			{ name: 'name', value: `name-${index}` },
		],
	})
}

/** The microseconds per record of a bulk write rewriting the `ref` of `WRITTEN_RECORDS` records of the tag. */
async function writeMicrosPerRecord(params: {
	engine: SqliteEngine
	tagName: string
	round: number
}): Promise<number> {
	const { engine, tagName, round } = params
	const updates = Array.from({ length: WRITTEN_RECORDS }, (_, index) => ({
		recordId: `${tagName}-${String(index * 3).padStart(6, '0')}`,
		attributes: [
			{ name: 'uuid', value: crypto.randomUUID() },
			{ name: 'ref', value: `ref-${round}-${index}` },
			{ name: 'name', value: `name-${index}` },
		],
	}))
	const startedAt = performance.now()
	await engine.bulkWrite(DOCUMENT_ID, { updates })
	return ((performance.now() - startedAt) * 1000) / WRITTEN_RECORDS
}

describe.skipIf(!RUN)('the SQLite attribute index on a synthetic 60,000-record document', () => {
	afterAll(() => {
		for (const db of opened.splice(0)) db.close()
	})

	it(
		'one value looked up → from the index under its budget; size and write cost reported',
		async () => {
			const db = (await openMemoryFile({ opened })).connect()
			const engine = await startEngine({ db })
			await engine.registerDocument(makeDocument())
			const indexed = Array.from({ length: INDEXED_RECORDS }, (_, index) =>
				syntheticRecord({ index, tagName: 'A' }),
			)
			const other = Array.from({ length: OTHER_RECORDS }, (_, index) =>
				syntheticRecord({ index, tagName: 'B' }),
			)
			await engine.bulkWrite(DOCUMENT_ID, { creates: [...indexed, ...other] })
			const seq = seqOf({ db, documentId: DOCUMENT_ID })
			const wanted = indexed[INDEXED_RECORDS / 2]!.attributes[0]!.value
			const lookup = {
				documentId: DOCUMENT_ID,
				tagName: 'A',
				attributes: [{ name: 'uuid', values: [wanted] }],
			}

			const writeBefore = {
				A: await writeMicrosPerRecord({ engine, tagName: 'A', round: 0 }),
				B: await writeMicrosPerRecord({ engine, tagName: 'B', round: 0 }),
			}
			const bytesBefore = fileBytesOf({ db })
			const tagReadMs = await timed(async function tagReadThenFilter() {
				const records = await engine.getByTagNameInDocument('A', DOCUMENT_ID)
				return records.filter((record) => record.attributes.some((item) => item.value === wanted))
			})
			// the first lookups of the pair, answered by the SQL filter while it is built
			const firstStartedAt = performance.now()
			await engine.getByAttributes(lookup)
			const firstMs = performance.now() - firstStartedAt
			const buildStartedAt = performance.now()
			await untilPairsReady({ db, seq, pairs: 1 })
			const buildMs = performance.now() - buildStartedAt
			await engine.getByAttributes({ ...lookup, attributes: [{ name: 'ref', values: ['ref-1'] }] })
			await untilPairsReady({ db, seq, pairs: 2 })
			const indexMs = await timed(() => engine.getByAttributes(lookup))
			const bytesAfter = fileBytesOf({ db })
			const writeAfter = {
				A: await writeMicrosPerRecord({ engine, tagName: 'A', round: 1 }),
				B: await writeMicrosPerRecord({ engine, tagName: 'B', round: 1 }),
			}
			console.info(
				`[attribute-index] lookup of one uuid: tag read + JS filter ${tagReadMs.toFixed(2)} ms, ` +
					`SQL filter (first) ${firstMs.toFixed(2)} ms, index ${indexMs.toFixed(3)} ms; ` +
					`build of A.uuid (${INDEXED_RECORDS} records) ${buildMs.toFixed(0)} ms`,
			)
			console.info(
				`[attribute-index] file ${(bytesBefore / 1048576).toFixed(2)} MiB -> ${(bytesAfter / 1048576).toFixed(2)} MiB ` +
					`(+${(((bytesAfter - bytesBefore) / bytesBefore) * 100).toFixed(1)} %, 2 pairs of A)`,
			)
			console.info(
				`[attribute-index] write per record: A ${writeBefore.A.toFixed(1)} -> ${writeAfter.A.toFixed(1)} us ` +
					`(2 pairs), B ${writeBefore.B.toFixed(1)} -> ${writeAfter.B.toFixed(1)} us (none)`,
			)
			expect(indexMs).toBeLessThan(INDEXED_LOOKUP_BUDGET_MS)
		},
		BENCH_TIMEOUT_MS,
	)
})
