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

/** Records created, and records updated, by the merge-sized commit. */
const MERGE_HALF = 5_000

/** Merge-sized commits per document and variant; the bench takes their median. */
const MERGE_RUNS = 5

/** Records rewritten per write-cost run. */
const WRITTEN_RECORDS = 5_000

/** A lookup of one value from a ready pair answers one record: an index read stays far under a tag read. */
const INDEXED_LOOKUP_BUDGET_MS = 1

/** A write of records of a tag with two pairs costs at most this many times its cost without: an index scan per row would cost hundreds. */
const WRITE_COST_FACTOR_BUDGET = 4

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
	/** Only `name` rewritten, `uuid` and `ref` kept as they are (the indexed values unchanged). */
	keepIndexed?: boolean
}): Promise<number> {
	const { engine, tagName, round, keepIndexed = false } = params
	const ids = Array.from(
		{ length: WRITTEN_RECORDS },
		(_, index) => `${tagName}-${String(index * 3).padStart(6, '0')}`,
	)
	const held = await engine.getMany(ids, DOCUMENT_ID)
	const updates = ids.map((recordId, index) => ({
		recordId,
		attributes: keepIndexed
			? [...held[index]!.attributes.slice(0, 2), { name: 'name', value: `name-${round}-${index}` }]
			: [
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
				kept: await writeMicrosPerRecord({ engine, tagName: 'A', round: 10, keepIndexed: true }),
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
				kept: await writeMicrosPerRecord({ engine, tagName: 'A', round: 11, keepIndexed: true }),
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
					`(2 pairs, indexed values changed), ${writeBefore.kept.toFixed(1)} -> ${writeAfter.kept.toFixed(1)} us ` +
					`(2 pairs, indexed values kept), B ${writeBefore.B.toFixed(1)} -> ${writeAfter.B.toFixed(1)} us (none)`,
			)
			expect({
				indexFast: indexMs < INDEXED_LOOKUP_BUDGET_MS,
				writesBounded: writeAfter.A < WRITE_COST_FACTOR_BUDGET * writeBefore.A,
			}).toEqual({ indexFast: true, writesBounded: true })
		},
		BENCH_TIMEOUT_MS,
	)

	it(
		'a merge-sized commit (5,000 records created, 5,000 updated) → timed on a document without pairs and on one with two pairs',
		async () => {
			const db = (await openMemoryFile({ opened })).connect()
			const engine = await startEngine({ db })
			const plain = 'plain'
			const indexed = 'indexed'
			for (const documentId of [plain, indexed]) {
				await engine.registerDocument(makeDocument({ id: documentId }))
				await engine.bulkWrite(documentId, {
					creates: [
						...Array.from({ length: INDEXED_RECORDS }, (_, index) =>
							syntheticRecord({ index, tagName: 'A' }),
						),
						...Array.from({ length: OTHER_RECORDS }, (_, index) =>
							syntheticRecord({ index, tagName: 'B' }),
						),
					],
				})
			}
			const seq = seqOf({ db, documentId: indexed })
			for (const name of ['uuid', 'ref']) {
				await engine.getByAttributes({
					documentId: indexed,
					tagName: 'A',
					attributes: [{ name, values: ['x'] }],
				})
			}
			await untilPairsReady({ db, seq, pairs: 2 })
			const held = await engine.getByTagNameInDocument('A', plain)
			async function commitMs(params: {
				documentId: string
				round: number
				indexedValuesChange: boolean
			}): Promise<number> {
				const { documentId, round, indexedValuesChange } = params
				const creates = Array.from({ length: MERGE_HALF }, (_, index) =>
					syntheticRecord({ index: 100_000 * (round + 1) + index, tagName: 'A' }),
				)
				const updates = held.slice(0, MERGE_HALF).map((record, index) => ({
					...record,
					attributes: indexedValuesChange
						? [
								{ name: 'uuid', value: crypto.randomUUID() },
								{ name: 'ref', value: `ref-${round}-${index}` },
								{ name: 'name', value: `merged-${round}` },
							]
						: [...record.attributes.slice(0, 2), { name: 'name', value: `merged-${round}` }],
				}))
				const startedAt = performance.now()
				await engine.commit({
					documentId,
					writeId: crypto.randomUUID(),
					creates,
					updates,
					deletes: [],
				})
				return performance.now() - startedAt
			}
			const rows: string[] = []
			let round = 0
			for (const indexedValuesChange of [false, true]) {
				const times: Record<string, number[]> = { [plain]: [], [indexed]: [] }
				for (let run = 0; run < MERGE_RUNS; run++) {
					for (const documentId of [plain, indexed]) {
						const ms = await commitMs({ documentId, round: round++, indexedValuesChange })
						times[documentId]!.push(ms)
					}
				}
				rows.push(
					`updates ${indexedValuesChange ? 'changing' : 'keeping'} the indexed values: ` +
						`no pair ${median(times[plain]!).toFixed(0)} ms, 2 pairs ${median(times[indexed]!).toFixed(0)} ms`,
				)
			}
			console.info(
				`[attribute-index] commit of ${MERGE_HALF} creates + ${MERGE_HALF} updates of A: ${rows.join('; ')}`,
			)
			expect(rows).toHaveLength(2)
		},
		BENCH_TIMEOUT_MS,
	)
})
