/**
 * Record-layout bench: each cell imports one fixture into a fresh OPFS sahpool from a real worker
 * (real Chromium, disk-backed profile), through one variant sink, and keeps one result file per run
 * with the machine load. The timed runs carry no profiler and no concurrent commits; one extra
 * instrumented run per cell takes the CPU profile and the commits during the import. Runs only
 * under `--mode bench`; pick cells with `VITE_BENCH_CELLS` (a regular expression on the cell id,
 * `kill-after-` for the journal-off kill tests). Composed fixtures come from
 * `BENCH_SCL_FIXTURES_DIR`; the structural ones from `generate-stress-fixtures.ts`.
 *
 *   BENCH_SCL_FIXTURES_DIR=<dir> VITE_BENCH=1 VITE_BENCH_CELLS='^composed-50-compact' \
 *     nice -n 10 npx vitest run --project perf --mode bench src/store/sqlite/bench/layout.bench.test.ts
 */
import { BENCH_CELLS } from './bench-matrix'
import { buildCommitRecords } from './bench-variants'
import {
	BENCH_PHASE_MESSAGE,
	CELL_TIMEOUT_MS,
	COMMIT_CREATES_RECORDS,
	DOCUMENT_ID,
	EDIT_DELETE_SHARE,
	FIXTURE_ROOTS,
	KILL_AFTER_FAILURE_SPREAD_MS,
	KILL_CACHE_KIB,
	KILL_DELAY_MIN_MS,
	KILL_DELAY_SPREAD_MS,
	KILL_FAILURE_SHARE_MIN,
	KILL_FAILURE_SHARE_SPREAD,
	KILL_MIN_IN_PHASE,
	KILL_RUNS,
	KILL_TARGET_PHASES,
	OTHER_DOCUMENT_ID,
	PROFILE_GC_NODE,
	PROFILE_IDLE_NODES,
	PROFILE_SAMPLING_INTERVAL_US,
	PROFILED_FUNCTIONS,
	QUIET_LOAD,
	QUIET_SLICE_MS,
	QUIET_WAIT_MAX_MS,
	READ_REPEATS,
	SIDE_DOCUMENT_ID,
	SMALL_COMMIT_INTERVAL_MS,
	VARIANTS,
	WORKER_URL_PART,
} from './bench.constants'

import * as Comlink from 'comlink'
import { describe, expect, it } from 'vitest'
import { commands, server } from 'vitest/browser'

import type {
	BenchCell,
	BenchDevice,
	BenchFixture,
	BenchFixtureName,
	BenchPhase,
	BenchPhaseMessage,
	BenchRun,
	BenchWorkerApi,
	EditSteps,
	EditTimings,
	FixtureRoot,
	KillRun,
	KillScenario,
	SmallCommitResult,
	SpawnedBenchWorker,
} from './bench.types'

const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'
const CELL_FILTER = new RegExp(import.meta.env.VITE_BENCH_CELLS ?? '^$')
/** Fewer timed runs per cell for a smoke run (`VITE_BENCH_RUNS=1`); the protocol's count otherwise. */
const RUNS_OVERRIDE = Number(import.meta.env.VITE_BENCH_RUNS) || undefined
/** The worker's CPU profile goes through CDP: Chromium only (the Firefox run keeps the commits, not the profile). */
const CAN_PROFILE = server.browser === 'chromium'
/** A stricter quiet-machine bar for latency runs (`VITE_BENCH_QUIET_LOAD=3`), and how long to wait for it. */
const QUIET_BAR = Number(import.meta.env.VITE_BENCH_QUIET_LOAD) || QUIET_LOAD
const QUIET_WAIT_MS = Number(import.meta.env.VITE_BENCH_QUIET_WAIT_MS) || QUIET_WAIT_MAX_MS

let loadedFile: { name: BenchFixtureName; file: File } | undefined

function spawnBenchWorker(): SpawnedBenchWorker {
	const worker = new Worker(new URL('./layout-bench.worker.ts', import.meta.url), {
		type: 'module',
	})
	return { worker, api: Comlink.wrap<BenchWorkerApi>(worker) as unknown as BenchWorkerApi }
}

function rootOf(params: { fixture: BenchFixtureName }): FixtureRoot {
	return params.fixture.startsWith('structural') ? FIXTURE_ROOTS.structural : FIXTURE_ROOTS.composed
}

/** The fixture as a `File` (fetched once per fixture; the import starts with the file in hand). */
async function fixtureFile(params: { fixture: BenchFixture }): Promise<File> {
	const { fixture } = params
	if (loadedFile?.name === fixture.name) return loadedFile.file
	loadedFile = undefined
	const response = await fetch(fixture.url)
	if (!response.ok) throw new Error(`fixture ${fixture.name} not served (${response.status})`)
	const file = new File([await response.blob()], `${fixture.name}.xml`, { type: 'text/xml' })
	loadedFile = { name: fixture.name, file }
	return file
}

/**
 * Wait for a 1-minute load below the limit, one short command at a time: a browser command that
 * outlives vitest's RPC timeout closes the browser connection.
 */
async function waitForQuietMachine(): Promise<{ waitedMs: number }> {
	const startedAt = performance.now()
	for (;;) {
		const { load } = await commands.benchWaitForQuiet({
			maxLoad: QUIET_BAR,
			maxWaitMs: QUIET_SLICE_MS,
		})
		const waitedMs = performance.now() - startedAt
		if (load[0]! < QUIET_BAR || waitedMs > QUIET_WAIT_MS) return { waitedMs }
	}
}

async function benchDevice(): Promise<BenchDevice> {
	const node = await commands.benchDevice()
	return {
		...node,
		hardwareConcurrency: navigator.hardwareConcurrency,
		deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
	}
}

/** The longest main-thread task while `work` runs (-1 where the browser has no long-task entries). */
async function watchLongTasks<GenericResult>(
	work: () => Promise<GenericResult>,
): Promise<{ result: GenericResult; longestMs: number }> {
	let longestMs = 0
	const supported = PerformanceObserver.supportedEntryTypes.includes('longtask')
	const observer = new PerformanceObserver(function keepLongest(list) {
		for (const entry of list.getEntries()) longestMs = Math.max(longestMs, entry.duration)
	})
	if (supported) observer.observe({ type: 'longtask' })
	try {
		return { result: await work(), longestMs: supported ? longestMs : -1 }
	} finally {
		observer.disconnect()
	}
}

/** Small commits from the page, one in flight at a time, while `work` runs. */
async function withSmallCommits<GenericResult>(params: {
	api: BenchWorkerApi
	enabled: boolean
	work: () => Promise<GenericResult>
}): Promise<{ result: GenericResult; commits: SmallCommitResult[] }> {
	const { api, enabled, work } = params
	const commits: SmallCommitResult[] = []
	let inFlight = false
	const timer = enabled
		? setInterval(function issueSmallCommit() {
				if (inFlight) return
				inFlight = true
				const startedAt = performance.now()
				api.commitSmall({ documentId: SIDE_DOCUMENT_ID }).then(
					function keepCommit({ commitMs }) {
						commits.push({ commitMs, roundTripMs: performance.now() - startedAt })
						inFlight = false
					},
					function dropCommit() {
						inFlight = false
					},
				)
			}, SMALL_COMMIT_INTERVAL_MS)
		: undefined
	try {
		return { result: await work(), commits }
	} finally {
		clearInterval(timer)
	}
}

async function timedRepeats<GenericResult>(
	work: () => Promise<GenericResult>,
): Promise<{ ms: number[]; last: GenericResult }> {
	const ms: number[] = []
	let last: GenericResult | undefined
	for (let index = 0; index < READ_REPEATS; index++) {
		const startedAt = performance.now()
		last = await work()
		ms.push(performance.now() - startedAt)
	}
	return { ms, last: last as GenericResult }
}

async function roundTrip<GenericSteps extends EditSteps>(
	work: () => Promise<GenericSteps>,
): Promise<GenericSteps & { roundTripMs: number }> {
	const startedAt = performance.now()
	const steps = await work()
	return { ...steps, roundTripMs: performance.now() - startedAt }
}

/** The 100K-record commit built on the page and sent over the port, then the 10 % delete, undo and redo. */
async function measureEdits(params: { api: BenchWorkerApi }): Promise<EditTimings> {
	const { api } = params
	const rootId = await api.rootOf({ documentId: DOCUMENT_ID })
	const records = buildCommitRecords({ parentId: rootId, count: COMMIT_CREATES_RECORDS })
	return {
		commitCreates: await roundTrip(() => api.commitRecords({ documentId: DOCUMENT_ID, records })),
		// the pick walks the subtrees it chooses before the timed delete: their pages are warm, as after browsing them
		deleteSubtrees: await api
			.pickDeleteRoots({ documentId: DOCUMENT_ID, share: EDIT_DELETE_SHARE })
			.then(({ rootIds }) =>
				roundTrip(() => api.deleteRoots({ documentId: DOCUMENT_ID, rootIds })),
			),
		undo: await roundTrip(() => api.undo({ documentId: DOCUMENT_ID })),
		redo: await roundTrip(() => api.redo({ documentId: DOCUMENT_ID })),
	}
}

async function measureReads(params: { api: BenchWorkerApi }): Promise<BenchRun['reads']> {
	const { api } = params
	const targets = await api.pickReadTargets({ documentId: DOCUMENT_ID })
	const tree = await timedRepeats(() =>
		api.readTree({ documentId: DOCUMENT_ID, rootId: targets.rootId }),
	)
	const byTag = await timedRepeats(() =>
		api.readByTagName({ documentId: DOCUMENT_ID, tagName: targets.tagName }),
	)
	return {
		getTreeMs: tree.ms,
		treeRecords: tree.last.length,
		byTagMs: byTag.ms,
		byTagRecords: byTag.last.length,
		tagName: targets.tagName,
	}
}

/**
 * One run: the import, then (timed runs only) the order check, reads, edits, prepared database and
 * removal. The instrumented run profiles the worker and commits from the page during the import.
 */
async function runCell(params: {
	cell: BenchCell
	run: number
	instrumented: boolean
	device: BenchDevice
}): Promise<BenchRun> {
	const { cell, run, instrumented, device } = params
	const { variant, measures } = cell
	const fixture = await commands.benchFixture({ name: cell.fixture })
	const file = await fixtureFile({ fixture })
	const quiet = await waitForQuietMachine()
	const machine = await commands.benchMachine()
	const { worker, api } = spawnBenchWorker()
	const project = `${cell.id}-${run}-${crypto.randomUUID().slice(0, 8)}`
	const partial: Partial<BenchRun> = {}
	try {
		await api.open({ project, variant })
		if (instrumented && CAN_PROFILE)
			await commands.benchProfileStart({
				workerUrlIncludes: WORKER_URL_PART,
				samplingIntervalUs: PROFILE_SAMPLING_INTERVAL_US,
			})
		const startedAt = performance.now()
		const { result: imported, longestMs } = await watchLongTasks(() =>
			withSmallCommits({
				api,
				enabled: instrumented || measures.commitsDuringImport === true,
				work: () =>
					api.importFile({
						file,
						documentId: DOCUMENT_ID,
						afterImportRatio: cell.afterImportRatio,
						failAfterRecords:
							cell.failAtShare === undefined
								? undefined
								: Math.round(fixture.records * cell.failAtShare),
						root: rootOf({ fixture: cell.fixture }),
					}),
			}),
		)
		const dropToReadyMs = performance.now() - startedAt
		if (instrumented && CAN_PROFILE)
			partial.gc = await commands.benchProfileStop({
				gcNode: PROFILE_GC_NODE,
				idleNodes: PROFILE_IDLE_NODES,
				namedFunctions: PROFILED_FUNCTIONS,
			})
		partial.importResult = imported.result
		partial.smallCommits =
			instrumented || measures.commitsDuringImport ? imported.commits : undefined
		partial.dropToReadyMs = dropToReadyMs
		partial.mainLongestTaskMs = longestMs
		partial.recordsPerSecond = (fixture.records / dropToReadyMs) * 1000
		partial.sizesAfterImport = await api.sizes()
		if (!imported.result.failed && !instrumented) {
			if (measures.order) partial.order = await api.checkOrder({ documentId: DOCUMENT_ID, file })
			if (measures.reads) partial.reads = await measureReads({ api })
			if (measures.edits) partial.edits = await measureEdits({ api })
			if (measures.prepared)
				partial.prepared = await api.preparedDatabase({ project: `${project}-prepared` })
			if (measures.removal) {
				const { ms } = await api.removeDocument({ documentId: DOCUMENT_ID })
				partial.removal = { removeMs: ms, sizes: await api.sizes() }
			}
		}
	} catch (thrown) {
		partial.error = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)
	} finally {
		await api.destroy().catch(() => undefined)
		worker.terminate()
	}
	const benchRun: BenchRun = {
		cell: cell.id,
		run,
		instrumented,
		variant,
		fixture,
		afterImportRatio: cell.afterImportRatio,
		loadBefore: machine.load,
		loadAfter: (await commands.benchMachine()).load,
		waitedForQuietMs: quiet.waitedMs,
		swapUsedMiB: machine.swapUsedMiB,
		device,
		dropToReadyMs: partial.dropToReadyMs ?? -1,
		recordsPerSecond: partial.recordsPerSecond ?? 0,
		importResult: partial.importResult!,
		mainLongestTaskMs: partial.mainLongestTaskMs ?? -1,
		...partial,
	}
	await commands.benchRecord({
		name: `${cell.id}.${instrumented ? 'instrumented' : `run${run}`}`,
		data: benchRun,
	})
	return benchRun
}

/** The last phase marker the worker posted, as the page saw it. */
function trackPhases(params: { worker: Worker }): {
	last: () => BenchPhase | 'none'
	next: (phase: BenchPhase) => Promise<void>
} {
	let last: BenchPhase | 'none' = 'none'
	const waiting = new Map<BenchPhase, () => void>()
	params.worker.addEventListener(
		'message',
		function keepPhase(event: MessageEvent<BenchPhaseMessage>) {
			if (event.data?.type !== BENCH_PHASE_MESSAGE) return
			last = event.data.phase
			waiting.get(last)?.()
			waiting.delete(last)
		},
	)
	return {
		last: () => last,
		next: (phase) => new Promise<void>((resolve) => waiting.set(phase, resolve)),
	}
}

/** Kill the engine mid-import (journal off), reopen: the dead document drops, the other one is intact. */
async function runKill(params: { scenario: KillScenario; run: number }): Promise<KillRun> {
	const { scenario, run } = params
	const variant = VARIANTS.J2
	const other = await commands.benchFixture({ name: 'composed-catalogue-small' })
	const victim = await commands.benchFixture({ name: 'composed-50-compact' })
	const project = `kill-${scenario}-${run}-${crypto.randomUUID().slice(0, 8)}`
	await waitForQuietMachine()
	const load = (await commands.benchMachine()).load
	const first = spawnBenchWorker()
	const phases = trackPhases({ worker: first.worker })
	await first.api.open({
		project,
		variant,
		cacheKiB: KILL_CACHE_KIB,
		reportPhases: true,
		holdAtPhase: scenario === 'kill-after-parse-failure' ? 'dropping' : undefined,
	})
	await first.api.importFile({
		file: await fixtureFile({ fixture: other }),
		documentId: OTHER_DOCUMENT_ID,
		afterImportRatio: 0,
		root: FIXTURE_ROOTS.composed,
	})
	const before = await first.api.exportSignatures({ documentId: OTHER_DOCUMENT_ID })
	const victimFile = await fixtureFile({ fixture: victim })
	const startedAt = performance.now()
	const killDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
	const killAt =
		scenario === 'kill-after-spill'
			? killDelay(KILL_DELAY_MIN_MS + Math.random() * KILL_DELAY_SPREAD_MS)
			: phases.next('dropping').then(() => killDelay(Math.random() * KILL_AFTER_FAILURE_SPREAD_MS))
	void first.api
		.importFile({
			file: victimFile,
			documentId: DOCUMENT_ID,
			afterImportRatio: 0,
			failAfterRecords:
				scenario === 'kill-after-parse-failure'
					? Math.round(
							victim.records * (KILL_FAILURE_SHARE_MIN + Math.random() * KILL_FAILURE_SHARE_SPREAD),
						)
					: undefined,
			root: FIXTURE_ROOTS.composed,
		})
		.catch(() => undefined)
	await killAt
	const phaseAtKill = phases.last()
	first.worker.terminate()
	const killedAfterMs = performance.now() - startedAt
	const second = spawnBenchWorker()
	try {
		const reopen = await second.api.reopenAfterKill({
			project,
			otherDocumentId: OTHER_DOCUMENT_ID,
			variant,
		})
		const after = reopen.otherSignatures ?? new Uint32Array(0)
		const otherEqual =
			after.length === before.length &&
			after.every((signature, index) => signature === before[index])
		const killRun: KillRun = {
			scenario,
			run,
			killedAfterMs,
			phaseAtKill,
			reopen: { ...reopen, otherSignatures: undefined },
			otherEqual,
			load,
		}
		await commands.benchRecord({ name: `${scenario}.run${run}`, data: killRun })
		return killRun
	} finally {
		await second.api.destroy().catch(() => undefined)
		second.worker.terminate()
	}
}

describe('record layout bench (OPFS sahpool, real worker)', () => {
	const cells = BENCH_CELLS.filter((cell) => CELL_FILTER.test(cell.id))

	for (const cell of cells) {
		it.runIf(RUN)(
			cell.id,
			async () => {
				const device = await benchDevice()
				const timedRuns = RUNS_OVERRIDE ?? cell.runs
				const runs = [
					...Array.from({ length: timedRuns }, (_, index) => ({
						run: index + 1,
						instrumented: false,
					})),
					...(cell.measures.instrumented ? [{ run: timedRuns + 1, instrumented: true }] : []),
				]
				for (const { run, instrumented } of runs) {
					const result = await runCell({ cell, run, instrumented, device })
					expect(result.error, result.error).toBeUndefined()
					if (cell.failAtShare === undefined) expect(result.importResult.failed).toBeUndefined()
					if (result.order) {
						expect(result.order.afterImport).toMatchObject({ equal: true })
						expect(result.order.afterEdits).toMatchObject({ equal: true })
						expect(result.order.afterMultiParent).toMatchObject({ equal: true })
					}
				}
			},
			CELL_TIMEOUT_MS,
		)
	}

	for (const scenario of ['kill-after-spill', 'kill-after-parse-failure'] as const) {
		it.runIf(RUN && CELL_FILTER.test(scenario))(
			scenario,
			async () => {
				const runs: KillRun[] = []
				for (let run = 1; run <= (RUNS_OVERRIDE ?? KILL_RUNS); run++)
					runs.push(await runKill({ scenario, run }))
				expect(
					runs.filter(
						(killRun) =>
							!killRun.otherEqual ||
							killRun.reopen.integrityAfterDrop !== 'ok' ||
							killRun.reopen.tablesAfterSweep?.includes(`records_${DOCUMENT_ID}`) !== false,
					),
				).toEqual([])
				const inTargetPhase = runs.filter(
					(killRun) =>
						KILL_TARGET_PHASES[scenario].includes(killRun.phaseAtKill) &&
						killRun.reopen.droppedImporting > 0,
				)
				expect(inTargetPhase.length).toBeGreaterThanOrEqual(
					Math.min(KILL_MIN_IN_PHASE, runs.length),
				)
			},
			CELL_TIMEOUT_MS,
		)
	}
})
