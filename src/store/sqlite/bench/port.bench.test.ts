import { createEngineControl } from '../../engine/client/engine-control'
import { EngineStore } from '../../engine/engine-store'
import { engineLockNameOf } from '../../engine/project-key'
import { reportedDeviceMemoryGiB } from '../engine/device-cache'
import { SQLITE_WASM_URL } from '../sqlite-wasm-url'
import { commitWaitsOf, epochNow } from './bench-commit-waits'
import { stagesOf } from './bench-import-session'
import { fetchFixtureFile, waitForQuietMachine } from './bench-page'
import {
	COMMIT_EVERY_MS,
	ENGINE_BENCH_CELL_TIMEOUT_MS,
	ENGINE_BENCH_QUIET_LOAD,
	POOL_OPEN_RUNS,
	PORT_BENCH_DIALECTE,
	PORT_BENCH_FIXTURES,
	QUIET_WAIT_MAX_MS,
} from './bench.constants'

import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'

import { createSqliteWorkerConnector } from '@/store/sqlite/adapter/sqlite-worker-connector'

import type {
	CommitWaits,
	HistoryImport,
	PhaseChange,
	PoolOpenRuns,
	PortCommitsRun,
} from './bench.types'
import type { DocumentRecord } from '@/project/types'

/**
 * Port bench: the engine served from a worker, reached as a view reaches it - a EngineStore on the
 * direct-mode connector, every call over the store's port. On the composed 50 MB and 500 MB compact
 * files (the write-back session at the path-named ratio): the import alone, then again while a second
 * connection commits on another document every `COMMIT_EVERY_MS` (each commit's wait, apart when an
 * index build overlapped it); then the pool, holding the document, opened by new engine workers and
 * closed then opened again in one worker (`port-commits-<size>`); and a new pool's opens
 * (`port-open-new`). Runs only under `--mode bench`, a cell at a time below a 1-minute load of 8.
 *
 *   BENCH_SCL_FIXTURES_DIR=<dir> VITE_BENCH=1 VITE_BENCH_CELLS='^port-' \
 *     nice -n 10 npx vitest run --project perf --mode bench src/store/sqlite/bench/port.bench.test.ts
 */

const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'
const CELL_FILTER = new RegExp(import.meta.env.VITE_BENCH_CELLS ?? '^$')
const ENGINE_URL = new URL('./port-bench.worker.ts', import.meta.url).href

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

async function openStore(params: { name: string }): Promise<EngineStore> {
	const { name } = params
	const store = new EngineStore({
		name,
		connector: createSqliteWorkerConnector({
			...PORT_BENCH_DIALECTE,
			name,
			engineUrl: ENGINE_URL,
			perf: true,
		}),
	})
	await store.open()
	return store
}

/** The file imported through the store, its phases timed on the shared clock. */
async function importTimed(params: { store: EngineStore; file: File }): Promise<HistoryImport> {
	const { store, file } = params
	const phases: PhaseChange[] = []
	const startedAtEpochMs = epochNow()
	const result = await store.importFile({
		file,
		onProgress: function keepPhaseChanges(progress) {
			if (phases.at(-1)?.phase !== progress.phase) {
				phases.push({ phase: progress.phase, atEpochMs: epochNow() })
			}
		},
	})
	const endedAtEpochMs = epochNow()
	return {
		run: {
			dropToReadyMs: endedAtEpochMs - startedAtEpochMs,
			recordCount: result.recordCount,
			stages: stagesOf({ snapshot: result.perf }),
			databaseBytes: 0,
		},
		documentId: result.record.id,
		startedAtEpochMs,
		endedAtEpochMs,
		phases,
	}
}

/** `other`: a ready document of one record, the one the second connection commits on. */
async function seedOther(params: { store: EngineStore }): Promise<void> {
	const { store } = params
	const other: DocumentRecord = {
		id: 'other',
		name: 'other',
		extension: '.xml',
		configKey: 'default',
		createdAt: Date.now(),
		status: 'ready',
	}
	await store.registerDocument(other)
	await store.bulkWrite('other', { creates: [otherRecord({ value: '0' })] })
}

function otherRecord(params: { value: string }) {
	return {
		id: 'other-1',
		tagName: 'Other',
		namespace: { prefix: '', uri: 'http://dialecte.dev/XML/DEFAULT' },
		attributes: [],
		value: params.value,
		parent: null,
		children: [],
	}
}

/** A commit on `other` every `COMMIT_EVERY_MS` (none while one waits); `stop` sorts the waits by the import's index builds. */
function commitEvery(params: { store: EngineStore }): {
	stop: (params: { imported: HistoryImport }) => Promise<CommitWaits>
} {
	const { store } = params
	const sent: { sentAt: number; resolvedAt: number }[] = []
	const refused: unknown[] = []
	let waiting: Promise<void> | undefined
	const timer = setInterval(function sendCommit() {
		if (waiting) return
		const sentAt = epochNow()
		waiting = store
			.commit({
				documentId: 'other',
				creates: [],
				updates: [otherRecord({ value: String(sent.length + 1) })],
				deletes: [],
				onProgress: function ignoreProgress() {},
			})
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
			if (refused.length > 0) {
				throw new Error(`${refused.length} commits refused`, { cause: refused[0] })
			}
			return commitWaitsOf({ sent, imported })
		},
	}
}

/**
 * A pool opened `POOL_OPEN_RUNS` times by a new engine worker each (lock, probe, install, open), then
 * as many times closed and opened again in one worker (the pool resumed).
 */
async function poolOpens(params: { project: string }): Promise<PoolOpenRuns> {
	const { project } = params
	const open = {
		type: 'open',
		project,
		...PORT_BENCH_DIALECTE,
		settings: { wasmUrl: SQLITE_WASM_URL },
		lock: 'if-available',
		budgetMs: 30_000,
		perf: false,
	} as const
	const openMs: number[] = []
	for (let run = 0; run < POOL_OPEN_RUNS; run += 1) {
		const worker = new Worker(ENGINE_URL, { type: 'module' })
		const control = createEngineControl({ worker })
		const startedAt = performance.now()
		await control.request({ message: open, expect: 'opened' })
		openMs.push(performance.now() - startedAt)
		await control.request({ message: { type: 'close' }, expect: 'closed' })
		worker.terminate()
	}
	const resumeMs: number[] = []
	const worker = new Worker(ENGINE_URL, { type: 'module' })
	const control = createEngineControl({ worker })
	await control.request({ message: open, expect: 'opened' })
	for (let run = 0; run < POOL_OPEN_RUNS; run += 1) {
		await control.request({ message: { type: 'close' }, expect: 'closed' })
		const startedAt = performance.now()
		const opened = await control.request({ message: open, expect: 'opened' })
		resumeMs.push(performance.now() - startedAt)
		expect(opened.resumed).toBe(true)
	}
	await control.request({ message: { type: 'close' }, expect: 'closed' })
	worker.terminate()
	return { openMs, resumeMs }
}

async function measurePortCommits(params: { file: File; name: string }): Promise<PortCommitsRun> {
	const { file, name } = params
	const importer = await openStore({ name })
	const committer = await openStore({ name })
	try {
		const alone = await importTimed({ store: importer, file })
		await importer.removeDocument(alone.documentId)
		await seedOther({ store: committer })
		const commits = commitEvery({ store: committer })
		const imported = await importTimed({ store: importer, file }).catch(async function stopCommits(
			thrown: unknown,
		) {
			await commits.stop({ imported: alone }).catch(() => undefined)
			throw thrown
		})
		const waits = await commits.stop({ imported })
		importer.close()
		committer.close()
		// the realm's engine closes on its own time: the timed opens start once it let the project go
		await navigator.locks.request(
			engineLockNameOf({ dialecteId: PORT_BENCH_DIALECTE.dialecteId, project: name }),
			function projectFree() {},
		)
		return {
			recordCount: imported.run.recordCount,
			aloneMs: alone.run.dropToReadyMs,
			stagesAlone: alone.run.stages,
			withCommitsMs: imported.run.dropToReadyMs,
			stagesWithCommits: imported.run.stages,
			commits: waits,
			existingPool: await poolOpens({ project: name }),
		}
	} finally {
		const cleaner = await openStore({ name })
		await cleaner.destroy()
	}
}

describe('port bench (the engine served from a worker, over the store’s port)', () => {
	for (const [size, fixture] of Object.entries(PORT_BENCH_FIXTURES)) {
		const cell = `port-commits-${size}`
		it.runIf(RUN && CELL_FILTER.test(cell))(
			cell,
			async () => {
				const file = await fetchFixtureFile({
					fixture: await commands.benchFixture({ name: fixture }),
				})
				const result = (await recordCell({
					name: cell,
					run: () => measurePortCommits({ file, name: cell }),
				})) as PortCommitsRun
				expect(result.recordCount).toBeGreaterThan(0)
			},
			ENGINE_BENCH_CELL_TIMEOUT_MS,
		)
	}

	it.runIf(RUN && CELL_FILTER.test('port-open-new'))(
		'port-open-new',
		async () => {
			const project = `port-open-new-${crypto.randomUUID()}`
			try {
				await recordCell({ name: 'port-open-new', run: () => poolOpens({ project }) })
			} finally {
				const cleaner = await openStore({ name: project })
				await cleaner.destroy()
			}
		},
		ENGINE_BENCH_CELL_TIMEOUT_MS,
	)
})
