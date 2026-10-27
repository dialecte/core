/**
 * JSON-check bench: the check every store runs on what a write hands it, timed on records shaped like
 * the composed 50 MB file's, a parser batch at a time, in the page - `checkJsonValues` (what the
 * SQLite engine runs on an import's creates) and `toJsonCopy` (what the in-memory and IndexedDB
 * stores keep). Runs only under `--mode bench`, a cell at a time below a 1-minute load of 8; pick
 * cells with `VITE_BENCH_CELLS`.
 *
 *   VITE_BENCH=1 VITE_BENCH_CELLS='^json-' \
 *     nice -n 10 npx vitest run --project perf --mode bench src/store/sqlite/bench/json-check.bench.test.ts
 */
import { reportedDeviceMemoryGiB } from '../engine/device-cache'
import { waitForQuietMachine } from './bench-page'
import {
	ENGINE_BENCH_CELL_TIMEOUT_MS,
	ENGINE_BENCH_QUIET_LOAD,
	QUIET_WAIT_MAX_MS,
} from './bench.constants'
import { fixtureShapedRecords } from './json-check-bench-records'
import { JSON_CHECK_BENCH_PASSES, JSON_CHECK_BENCH_RECORDS } from './json-check-bench.constants'

import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'

import { checkJsonValues, toJsonCopy } from '@/store/json-values'
import { DEFAULT_BATCH_SIZE } from '@/xml/parse/parse-xml-document.constants'

import type { JsonCheckRun } from './json-check-bench.types'
import type { AnyRawRecord } from '@/types'

const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'
const CELL_FILTER = new RegExp(import.meta.env.VITE_BENCH_CELLS ?? '^$')

/** The members timed, each over the same batches. */
const MEMBERS: Record<
	string,
	{ member: JsonCheckRun['member']; run: (batch: unknown) => unknown }
> = {
	'json-check-50': {
		member: 'checkJsonValues',
		run: (batch) => checkJsonValues({ value: batch }),
	},
	'json-copy-50': { member: 'toJsonCopy', run: (batch) => toJsonCopy({ value: batch }) },
}

function batchesOf(params: { records: AnyRawRecord[] }): AnyRawRecord[][] {
	const { records } = params
	const batches: AnyRawRecord[][] = []
	for (let start = 0; start < records.length; start += DEFAULT_BATCH_SIZE) {
		batches.push(records.slice(start, start + DEFAULT_BATCH_SIZE))
	}
	return batches
}

/** One pass: every batch through the member, timed whole. */
function timePass(params: { batches: AnyRawRecord[][]; run: (batch: unknown) => unknown }): number {
	const { batches, run } = params
	const startedAt = performance.now()
	for (const batch of batches) run(batch)
	return performance.now() - startedAt
}

function timeMember(params: {
	member: JsonCheckRun['member']
	run: (batch: unknown) => unknown
}): JsonCheckRun {
	const { member, run } = params
	const batches = batchesOf({ records: fixtureShapedRecords({ count: JSON_CHECK_BENCH_RECORDS }) })
	timePass({ batches, run })
	const passesMs: number[] = []
	for (let pass = 0; pass < JSON_CHECK_BENCH_PASSES; pass++) {
		passesMs.push(timePass({ batches, run }))
	}
	const medianMs = [...passesMs].sort((left, right) => left - right)[passesMs.length >> 1]!
	return {
		member,
		records: JSON_CHECK_BENCH_RECORDS,
		batch: DEFAULT_BATCH_SIZE,
		passesMs,
		medianMs,
		nsPerRecord: (medianMs * 1e6) / JSON_CHECK_BENCH_RECORDS,
		msPerThousandRecords: (medianMs * 1_000) / JSON_CHECK_BENCH_RECORDS,
	}
}

describe('JSON-check bench (the store check, in the page)', () => {
	for (const [cell, { member, run }] of Object.entries(MEMBERS)) {
		it.runIf(RUN && CELL_FILTER.test(cell))(
			cell,
			async () => {
				const quiet = await waitForQuietMachine({
					maxLoad: ENGINE_BENCH_QUIET_LOAD,
					maxWaitMs: QUIET_WAIT_MAX_MS,
				})
				const device = {
					...(await commands.benchDevice()),
					deviceMemoryGiB: reportedDeviceMemoryGiB(),
				}
				const result = timeMember({ member, run })
				const loadAfter = (await commands.benchMachine()).load
				await commands.benchRecord({ name: cell, data: { device, quiet, loadAfter, result } })
				expect(result.medianMs).toBeGreaterThan(0)
			},
			ENGINE_BENCH_CELL_TIMEOUT_MS,
		)
	}
})
