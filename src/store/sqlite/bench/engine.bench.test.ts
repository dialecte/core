import { EngineStore } from '../../engine/engine-store'
import { createInProcessConnector } from '../adapter/in-process-link'
import { reportedDeviceMemoryGiB } from '../engine/device-cache'
import { commitWaitsOf, epochNow } from './bench-commit-waits'
import { createBenchImportRuntime, stagesOf } from './bench-import-session'
import { fetchFixtureFile, waitForQuietMachine } from './bench-page'
import {
	AFTER_IMPORT_RATIOS,
	COMMIT_EVERY_MS,
	DEAD_IMPORT_ROWS,
	ENGINE_BENCH_CELL_TIMEOUT_MS,
	ENGINE_BENCH_DIALECTE_ID,
	ENGINE_BENCH_QUIET_LOAD,
	FIXTURE_ROOTS,
	GATE_STEADY_CACHE_MIB,
	HISTORY_EXPORT_FIXTURES,
	QUIET_WAIT_MAX_MS,
	READY_500_RECORDS,
	VOLTAGE_LEVEL_TAG,
} from './bench.constants'

import * as Comlink from 'comlink'
import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'

import type {
	BenchFixtureName,
	CommitWaits,
	EngineBenchWorkerApi,
	EngineHistoryExportRun,
	EngineImportRun,
	HistoryImport,
} from './bench.types'

/**
 * Engine bench: the SQLite engine as built, timed on the composed 50 MB compact file (the write-back
 * session at the path-named ratio) through `EngineStore.importFile` in the page (in-memory file) and
 * through the engine in a worker on a real OPFS pool (the layout bench's setting); the engine's
 * start on a file holding a dead import in front of a ready 500 MB document; and, on the composed
 * 50 MB and 500 MB compact files in a worker on OPFS, the import alone and with another view
 * committing meanwhile (each commit's wait), the export, and the largest voltage level deleted,
 * undone and redone (`engine-history-export-<size>`). Runs only under
 * `--mode bench`, a cell at a time below a 1-minute load of 8; pick cells with `VITE_BENCH_CELLS`.
 *
 *   BENCH_SCL_FIXTURES_DIR=<dir> VITE_BENCH=1 VITE_BENCH_CELLS='^engine-import' \
 *     nice -n 10 npx vitest run --project perf --mode bench src/store/sqlite/bench/engine.bench.test.ts
 */

const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'
const CELL_FILTER = new RegExp(import.meta.env.VITE_BENCH_CELLS ?? '^$')
const IMPORT_FIXTURE = 'composed-50-compact'

async function fixtureFile(params: { name?: BenchFixtureName } = {}): Promise<File> {
	const fixture = await commands.benchFixture({ name: params.name ?? IMPORT_FIXTURE })
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
	const store = new EngineStore({ name, connector })
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

/**
 * One file, one engine in a worker on OPFS: imported alone then removed (the import's own time); a
 * ready document `other`; the file imported again while this page commits on `other` every
 * `COMMIT_EVERY_MS` through the worker's port, as another view's edits reach the engine (each
 * commit's wait as this page sees it, apart when an index build overlapped it); the document
 * exported; its largest voltage level deleted by one commit, undone, redone - at the device's cache,
 * then on an engine started again at the gate's 64 MiB.
 */
async function measureHistoryAndExport(params: {
	api: EngineBenchWorkerApi
	file: File
	project: string
}): Promise<EngineHistoryExportRun> {
	const { api, file, project } = params
	const setting = {
		project,
		root: FIXTURE_ROOTS.composed,
		afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
	}
	await api.historyOpen(setting)
	const alone = await api.historyImport({ file, writeId: 'w-alone' })
	await api.historyRemove({ documentId: alone.documentId })
	await api.historySeedOther()
	const committing = commitEvery({ api })
	const withCommits = await api.historyImport({ file, writeId: 'w-with-commits' })
	const commitWaits = await committing.stop({ imported: withCommits })
	const { documentId } = withCommits
	const exported = await api.historyExport({ documentId })
	await api.historyFindSubtree({ documentId, tagName: VOLTAGE_LEVEL_TAG })
	const atDeviceCache = await api.historyEditSubtree({ documentId })
	await api.historyOpen({ ...setting, steadyCacheMiB: GATE_STEADY_CACHE_MIB })
	// the subtree is deleted (the last redo): brought back first, then deleted again from scratch
	await api.historyUndo({ documentId })
	const atGateCache = await api.historyEditSubtree({ documentId })
	return {
		importAlone: alone.run,
		importWithCommits: withCommits.run,
		commitWaits,
		export: exported,
		voltageLevel: { atDeviceCache, atGateCache },
	}
}

/**
 * A commit on `other` sent every `COMMIT_EVERY_MS` (none while one is waiting, as a view waits for
 * its save), each one's wait from sent to resolved; `stop` waits for the one still under way, then
 * sorts them by the import's index builds. A refused commit fails the cell.
 */
function commitEvery(params: { api: EngineBenchWorkerApi }): {
	stop: (params: { imported: HistoryImport }) => Promise<CommitWaits>
} {
	const { api } = params
	const sent: { sentAt: number; resolvedAt: number }[] = []
	const refused: unknown[] = []
	let waiting: Promise<void> | undefined
	const timer = setInterval(function sendCommit() {
		if (waiting) return
		const sentAt = epochNow()
		waiting = api
			.historyCommitOther({ value: String(sent.length + 1) })
			.then(
				function keepWait() {
					sent.push({ sentAt, resolvedAt: epochNow() })
				},
				function keepRefusal(thrown: unknown) {
					refused.push(thrown)
				},
			)
			.finally(function sendNext() {
				waiting = undefined
			})
	}, COMMIT_EVERY_MS)
	return {
		stop: async function stop({ imported }) {
			clearInterval(timer)
			await waiting
			if (refused.length > 0)
				throw new Error(`${refused.length} commits refused`, { cause: refused[0] })
			return commitWaitsOf({ sent, imported })
		},
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

	it.runIf(RUN && CELL_FILTER.test('engine-liveness-500-opfs-worker'))(
		'engine-liveness-500-opfs-worker',
		async () => {
			const file = await fixtureFile({ name: 'composed-500-compact' })
			const { worker, api } = spawnEngineWorker()
			try {
				const result = (await recordCell({
					name: 'engine-liveness-500-opfs-worker',
					run: () =>
						api.importOnOpfs({
							file,
							project: 'engine-liveness-500',
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

	for (const [size, name] of Object.entries(HISTORY_EXPORT_FIXTURES)) {
		const cell = `engine-history-export-${size}`
		it.runIf(RUN && CELL_FILTER.test(cell))(
			cell,
			async () => {
				const file = await fixtureFile({ name })
				const { worker, api } = spawnEngineWorker()
				try {
					const result = (await recordCell({
						name: cell,
						run: () => measureHistoryAndExport({ api, file, project: cell }),
					})) as EngineHistoryExportRun
					expect(result.export.fileBytes).toBeGreaterThan(0)
				} finally {
					await api.historyClose().catch(() => undefined)
					worker.terminate()
				}
			},
			ENGINE_BENCH_CELL_TIMEOUT_MS,
		)
	}

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
