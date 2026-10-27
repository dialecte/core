/**
 * Engine bench: the SQLite engine as built, timed on the composed 50 MB compact file (the write-back
 * session at the path-named ratio) through `SqliteStore.importFile` in the page (in-memory file) and
 * through the engine in a worker on a real OPFS pool (the layout bench's setting); and the engine's
 * start on a file holding a dead import in front of a ready 500 MB document. Runs only under
 * `--mode bench`, a cell at a time below a 1-minute load of 8; pick cells with `VITE_BENCH_CELLS`.
 *
 *   BENCH_SCL_FIXTURES_DIR=<dir> VITE_BENCH=1 VITE_BENCH_CELLS='^engine-import' \
 *     nice -n 10 npx vitest run --project perf --mode bench src/store/sqlite/bench/engine.bench.test.ts
 */
import { createInProcessConnector } from '../adapter/in-process-link'
import { SqliteStore } from '../adapter/sqlite-store'
import { reportedDeviceMemoryGiB } from '../engine/device-cache'
import { createBenchImportRuntime, stagesOf } from './bench-import-session'
import { fetchFixtureFile, waitForQuietMachine } from './bench-page'
import {
	AFTER_IMPORT_RATIOS,
	DEAD_IMPORT_ROWS,
	ENGINE_BENCH_CELL_TIMEOUT_MS,
	ENGINE_BENCH_DIALECTE_ID,
	ENGINE_BENCH_QUIET_LOAD,
	FIXTURE_ROOTS,
	QUIET_WAIT_MAX_MS,
	READY_500_RECORDS,
} from './bench.constants'

import * as Comlink from 'comlink'
import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'

import type { EngineBenchWorkerApi, EngineImportRun } from './bench.types'

const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'
const CELL_FILTER = new RegExp(import.meta.env.VITE_BENCH_CELLS ?? '^$')
const IMPORT_FIXTURE = 'composed-50-compact'

async function fixtureFile(): Promise<File> {
	const fixture = await commands.benchFixture({ name: IMPORT_FIXTURE })
	return fetchFixtureFile({ fixture })
}

function spawnEngineWorker(): { worker: Worker; api: EngineBenchWorkerApi } {
	const worker = new Worker(new URL('./engine-bench.worker.ts', import.meta.url), {
		type: 'module',
	})
	return {
		worker,
		api: Comlink.wrap<EngineBenchWorkerApi>(worker) as unknown as EngineBenchWorkerApi,
	}
}

/** One timed cell: a quiet machine first, the run, its load before and after, one result file. */
async function recordCell(params: { name: string; run: () => Promise<object> }): Promise<object> {
	const { name, run } = params
	const quiet = await waitForQuietMachine({
		maxLoad: ENGINE_BENCH_QUIET_LOAD,
		maxWaitMs: QUIET_WAIT_MAX_MS,
	})
	const device = { ...(await commands.benchDevice()), deviceMemoryGiB: reportedDeviceMemoryGiB() }
	const result = await run()
	const loadAfter = (await commands.benchMachine()).load
	await commands.benchRecord({ name, data: { device, quiet, loadAfter, result } })
	return result
}

async function importInProcess(params: { file: File }): Promise<EngineImportRun> {
	const name = `engine-bench-${crypto.randomUUID()}`
	const connector = createInProcessConnector({
		name,
		dialecteId: ENGINE_BENCH_DIALECTE_ID,
		runtime: createBenchImportRuntime({
			root: FIXTURE_ROOTS.composed,
			afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
		}),
	})
	const store = new SqliteStore({ name, connector })
	await store.open()
	try {
		const startedAt = performance.now()
		const result = await store.importFile({ file: params.file })
		return {
			dropToReadyMs: performance.now() - startedAt,
			recordCount: result.recordCount,
			stages: stagesOf({ snapshot: result.perf }),
			databaseBytes: 0,
		}
	} finally {
		await store.destroy()
	}
}

describe('engine bench (the SQLite engine as built)', () => {
	it.runIf(RUN && CELL_FILTER.test('engine-import-50-in-process'))(
		'engine-import-50-in-process',
		async () => {
			const file = await fixtureFile()
			const result = (await recordCell({
				name: 'engine-import-50-in-process',
				run: () => importInProcess({ file }),
			})) as EngineImportRun
			expect(result.recordCount).toBeGreaterThan(0)
		},
		ENGINE_BENCH_CELL_TIMEOUT_MS,
	)

	it.runIf(RUN && CELL_FILTER.test('engine-import-50-opfs-worker'))(
		'engine-import-50-opfs-worker',
		async () => {
			const file = await fixtureFile()
			const { worker, api } = spawnEngineWorker()
			try {
				const result = (await recordCell({
					name: 'engine-import-50-opfs-worker',
					run: () =>
						api.importOnOpfs({
							file,
							project: 'engine-import-50',
							root: FIXTURE_ROOTS.composed,
							afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
						}),
				})) as EngineImportRun
				expect(result.recordCount).toBeGreaterThan(0)
			} finally {
				worker.terminate()
			}
		},
		ENGINE_BENCH_CELL_TIMEOUT_MS,
	)

	for (const [dead, deadRows] of Object.entries(DEAD_IMPORT_ROWS)) {
		const cell = `engine-start-${dead}-before-ready-500`
		it.runIf(RUN && CELL_FILTER.test(cell))(
			cell,
			async () => {
				const { worker, api } = spawnEngineWorker()
				try {
					await recordCell({
						name: cell,
						run: () => api.measureStart({ project: cell, deadRows, readyRows: READY_500_RECORDS }),
					})
				} finally {
					worker.terminate()
				}
			},
			ENGINE_BENCH_CELL_TIMEOUT_MS,
		)
	}
})
