import { CONTRACT_DIALECTE } from '../../contract/store-contract.dialecte'
import { createHeartbeat } from '../../engine/host/heartbeat'
import { loadSqlite } from '../load-sqlite'
import { poolDirectoryOf } from './install-pool'
import { installProgressBeat } from './progress-beat'
import { OPAQUE_DIRECTORY, PROGRESS_BEAT_OPS } from './runtime.constants'
import {
	RUNTIME_FIXTURE_CHANNEL,
	SLOW_DDL_MS,
	SLOW_DESTROY_MS,
	SLOW_DDL_PATTERN,
	SLOW_STATEMENT_STEP_MS,
	YIELDING_SLICE_MS,
} from './runtime.fixtures.constants'

import { defineDialecte } from '@/dialecte'
import { serveDialecteEngine } from '@/engine'
import { yieldToQueue } from '@/utils/yield-to-queue'

import type {
	DestroyShape,
	ProgressBeatOrder,
	RuntimeFixtureMessage,
	RuntimeFixtureNotice,
	RuntimeFixtureOrder,
	RuntimeFixtureScenario,
} from './runtime.fixtures.types'
import type { SyncAccessFileHandle } from './runtime.types'
import type { AnyRawRecord } from '@/types'

/**
 * The contract dialecte's engine worker on a platform a case shapes (`?scenario=`): no private file
 * system, a quota nearly used up, room for a pool but not for a large import, a worker deaf to
 * `close`, one ended or throwing from a timer on the case's order, one whose module fails to load;
 * or, `holder`, no engine at all - a worker holding one file of a project's pool, as an engine that
 * ended may still do.
 */
const scenario = new URL(self.location.href).searchParams.get(
	'scenario',
) as RuntimeFixtureScenario | null

const FREE_BYTES_OF_SCENARIO: Partial<Record<RuntimeFixtureScenario, number>> = {
	'small-quota': 1000,
	'import-quota': 2 * 1024 * 1024,
}

if (scenario === 'broken') throw new Error('a worker module failing as it loads')

if (scenario === 'no-opfs') {
	Object.defineProperty(StorageManager.prototype, 'getDirectory', {
		value: undefined,
		configurable: true,
	})
}
if (scenario === 'disk-full') fillDiskWhenOrdered()
if (scenario === 'install-fails') failPoolInstall({ once: false })
if (scenario === 'install-fails-once') failPoolInstall({ once: true })

const freeBytes = scenario ? FREE_BYTES_OF_SCENARIO[scenario] : undefined
if (freeBytes !== undefined) {
	StorageManager.prototype.estimate = async function estimateShort() {
		return { quota: 10 * 1024 * 1024 * 1024, usage: 10 * 1024 * 1024 * 1024 - freeBytes }
	}
}

/**
 * Once the case orders `disk-full` (and `afterWrites` more writes went through), the origin is out of
 * storage: every write to a file of the private file system throws `QuotaExceededError` (as the
 * browser's quota does) and the estimate says nothing is left - until it orders `disk-free`. Ordered
 * `write-fails`, every write throws an error that is not the quota's while room is left.
 */
function fillDiskWhenOrdered(): void {
	let full = false
	let writesLeft: number | undefined
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	let failing = false
	channel.addEventListener('message', function fillDisk(event: MessageEvent<RuntimeFixtureOrder>) {
		const order = event.data
		if (order.type === 'disk-free') {
			full = false
			failing = false
			writesLeft = undefined
		}
		if (order.type === 'write-fails') failing = true
		if (order.type === 'disk-full') {
			writesLeft = order.afterWrites ?? 0
			full = writesLeft === 0
		}
		if (order.type === 'disk-free' || order.type === 'write-fails' || order.type === 'disk-full') {
			acknowledge({ channel, order })
		}
	})
	const handles = (globalThis as { FileSystemSyncAccessHandle?: { prototype: { write: unknown } } })
		.FileSystemSyncAccessHandle
	if (!handles) return
	const write = handles.prototype.write as (...args: unknown[]) => number
	handles.prototype.write = function writeUnlessFull(this: unknown, ...args: unknown[]) {
		if (!full && writesLeft !== undefined) {
			writesLeft -= 1
			full = writesLeft < 0
		}
		if (full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
		if (failing) throw new DOMException('The file could not be written.', 'InvalidStateError')
		return write.apply(this, args)
	}
	const estimate = StorageManager.prototype.estimate
	StorageManager.prototype.estimate = async function estimateWhileFull(this: StorageManager) {
		if (!full) return estimate.call(this)
		return { quota: 10 * 1024 * 1024 * 1024, usage: 10 * 1024 * 1024 * 1024 }
	}
}

/**
 * The fixture dialecte's engine, its platform shaped first - in this turn: a message arriving before a
 * listener is there is lost.
 */
function serveEngine(): void {
	if (scenario === 'ignore-close') ignoreClose()
	if (scenario === 'ignore-destroy') shapeDestroy({ whileOpen: 'deaf', fresh: 'at-once' })
	if (scenario === 'slow-destroy') shapeDestroy({ whileOpen: 'late', fresh: 'at-once' })
	if (scenario === 'ignore-destroy-slow-fresh') shapeDestroy({ whileOpen: 'deaf', fresh: 'late' })
	if (scenario === 'ignore-destroy-always') shapeDestroy({ whileOpen: 'deaf', fresh: 'deaf' })
	if (scenario === 'end-on-destroy') shapeDestroy({ whileOpen: 'end', fresh: 'at-once' })
	if (scenario === 'endable' || scenario === 'uncaught-error') followCaseOrders()
	if (scenario === 'slow-statements' || scenario === 'slow-statements-silent') {
		slowStatements({ silent: scenario === 'slow-statements-silent' })
	}
	if (scenario === 'liveness') slowDdlWhenOrdered()
	if (scenario === 'close-throws') failCloseWhenOrdered()
	serveDialecteEngine({ dialecte: RUNTIME_FIXTURE_DIALECTE })
}

/**
 * Every call of SQLite's progress handler made slow (each waits `SLOW_STATEMENT_STEP_MS`) once the
 * case orders `slow` - a statement then runs for seconds; `silent`, the engine's own handler is never
 * called (a long statement with no beat).
 */
function slowStatements(params: { silent: boolean }): void {
	let slow = false
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.addEventListener('message', function slowDown(event: MessageEvent<RuntimeFixtureOrder>) {
		if (event.data.type !== 'slow') return
		slow = true
		acknowledge({ channel, order: event.data })
	})
	// chained on the realm's one load before the engine's open awaits it: patched before any database
	void loadSqlite().then(function patchProgressHandler(sqlite3) {
		const install = sqlite3.capi.sqlite3_progress_handler
		sqlite3.capi.sqlite3_progress_handler = function installSlowed(db, ops, handler, context) {
			return install(
				db,
				ops,
				function slowedHandler(pointer: number) {
					if (slow) busyWait({ ms: SLOW_STATEMENT_STEP_MS })
					return slow && params.silent ? 0 : (handler as (pointer: number) => number)(pointer)
				},
				context,
			)
		} as typeof install
	})
}

/**
 * A pool file's second handle refused (as a file that cannot be opened is): the probe, which opens and
 * closes each file once, passes; then the pool's install fails on each file it acquires - with no file
 * held by anyone else. `once`: that second handle only, every later one opened (an install tried again).
 */
function failPoolInstall(params: { once: boolean }): void {
	const acquired = new Map<string, number>()
	const createSyncAccessHandle = (FileSystemFileHandle.prototype as unknown as SyncAccessFileHandle)
		.createSyncAccessHandle
	Object.defineProperty(FileSystemFileHandle.prototype, 'createSyncAccessHandle', {
		configurable: true,
		value: function acquireFailing(this: FileSystemFileHandle) {
			const count = (acquired.get(this.name) ?? 0) + 1
			acquired.set(this.name, count)
			if (params.once ? count === 2 : count >= 2) {
				return Promise.reject(
					new DOMException('The file could not be opened.', 'InvalidStateError'),
				)
			}
			return createSyncAccessHandle.call(this)
		},
	})
}

/** An order taken, said on the fixture channel: the case goes on once the worker has it. */
function acknowledge(params: { channel: BroadcastChannel; order: RuntimeFixtureOrder }): void {
	const notice: RuntimeFixtureNotice = { type: 'ack', of: params.order.type }
	params.channel.postMessage(notice)
}

function tellFixtureChannel(notice: RuntimeFixtureNotice): void {
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.postMessage(notice)
	channel.close()
}

/**
 * Once the case orders `slow-ddl`, every record-index build and every table drop holds its statement
 * `SLOW_DDL_MS` before it runs - one long opcode, as a large sort or drop is: no progress-handler call
 * inside it, so no beat.
 */
function slowDdlWhenOrdered(): void {
	let slow = false
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.addEventListener('message', function slowDown(event: MessageEvent<RuntimeFixtureOrder>) {
		if (event.data.type !== 'slow-ddl') return
		slow = true
		acknowledge({ channel, order: event.data })
	})
	void loadSqlite().then(function patchExec(sqlite3) {
		const prototype = sqlite3.oo1.DB.prototype
		const exec = prototype.exec
		prototype.exec = function slowedExec(this: typeof prototype, ...args: unknown[]) {
			const first = args[0]
			const sql = typeof first === 'string' ? first : (first as { sql?: unknown } | undefined)?.sql
			if (slow && typeof sql === 'string' && SLOW_DDL_PATTERN.test(sql))
				busyWait({ ms: SLOW_DDL_MS })
			return (exec as (...given: unknown[]) => unknown).apply(this, args)
		} as typeof exec
	})
}

/**
 * Once the case orders `close-throws`, the next database close closes the database, then throws - a
 * close that reports a failure (the engine must let go of the files all the same).
 */
function failCloseWhenOrdered(): void {
	let failNext = false
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.addEventListener('message', function armClose(event: MessageEvent<RuntimeFixtureOrder>) {
		if (event.data.type !== 'close-throws') return
		failNext = true
		acknowledge({ channel, order: event.data })
	})
	void loadSqlite().then(function patchClose(sqlite3) {
		const prototype = sqlite3.oo1.DB.prototype
		const close = prototype.close
		prototype.close = function closeThenThrow(this: typeof prototype, ...args: unknown[]) {
			const closed = (close as (...given: unknown[]) => unknown).apply(this, args)
			if (!failNext) return closed
			failNext = false
			throw new Error('the database would not close')
		} as typeof close
	})
}

/** Answer `run-statement` with a database of its own: the heartbeat on the port given, one long statement, its times. */
function serveProgressBeat(): void {
	self.addEventListener(
		'message',
		async function runStatement(event: MessageEvent<ProgressBeatOrder>) {
			const sqlite3 = await loadSqlite()
			const db = new sqlite3.oo1.DB(':memory:', 'c')
			const heartbeat = createHeartbeat({ intervalMs: event.data.intervalMs })
			heartbeat.add(event.data.port)
			installProgressBeat({ sqlite3, db, heartbeat, ops: PROGRESS_BEAT_OPS })
			const startedAt = performance.timeOrigin + performance.now()
			db.selectValue(
				'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ?) SELECT count(*) FROM c',
				[event.data.rows],
			)
			const endedAt = performance.timeOrigin + performance.now()
			db.close()
			self.postMessage({ startedAt, endedAt })
		},
	)
}

function busyWait(params: { ms: number }): void {
	const until = performance.now() + params.ms
	while (performance.now() < until);
}

/**
 * The contract dialecte, its session pausing as the file says: a record of the session's tag whose
 * `bB` is `pause:<ms>` holds the parse that long (no statement, no beat: as a paused engine),
 * `after-pause:<ms>` holds `afterImport` that long (dialecte code the engine tells as busy),
 * `after-yield-pause:<ms>` holds it that long in slices with a message turn between them.
 */
const RUNTIME_FIXTURE_DIALECTE = defineDialecte({
	id: CONTRACT_DIALECTE.id,
	version: CONTRACT_DIALECTE.version,
	configs: CONTRACT_DIALECTE.configs,
	defaultConfigKey: CONTRACT_DIALECTE.defaultConfigKey,
	createHooks: function createPausingHooks() {
		const hooks = CONTRACT_DIALECTE.createHooks()
		const createContractSession = hooks.createImportSession!
		return {
			...hooks,
			createImportSession: function createPausingSession(sessionParams) {
				const session = createContractSession(sessionParams)
				let afterPauseMs = 0
				let afterYieldPauseMs = 0
				return {
					...session,
					beforeImportRecord: function pauseOnRecord(recordParams) {
						const marker = markerOf({ record: recordParams.record })
						if (marker?.kind === 'pause') {
							tellFixtureChannel({ type: 'reached', marker: 'pause' })
							busyWait({ ms: marker.ms })
						}
						if (marker?.kind === 'after-pause') afterPauseMs = marker.ms
						if (marker?.kind === 'after-yield-pause') afterYieldPauseMs = marker.ms
						session.beforeImportRecord?.(recordParams)
					},
					afterImport: async function pauseAfterImport() {
						if (afterPauseMs > 0) tellFixtureChannel({ type: 'reached', marker: 'after-pause' })
						if (afterYieldPauseMs > 0) {
							tellFixtureChannel({ type: 'reached', marker: 'after-yield-pause' })
						}
						busyWait({ ms: afterPauseMs })
						// dialecte code that yields now and then: other calls are served between its slices
						for (let spent = 0; spent < afterYieldPauseMs; spent += YIELDING_SLICE_MS) {
							busyWait({ ms: YIELDING_SLICE_MS })
							await yieldToQueue()
						}
						return session.afterImport!()
					},
				}
			},
		}
	},
})

/** A pause marker a record carries in `bB`. */
function markerOf(params: {
	record: AnyRawRecord
}): { kind: 'pause' | 'after-pause' | 'after-yield-pause'; ms: number } | undefined {
	const value = params.record.attributes.find((attribute) => attribute.name === 'bB')?.value
	const match =
		typeof value === 'string' ? /^(pause|after-pause|after-yield-pause):(\d+)$/.exec(value) : null
	return match
		? { kind: match[1] as 'pause' | 'after-pause' | 'after-yield-pause', ms: Number(match[2]) }
		: undefined
}

/** A worker that never answers `close`: its realm must end it anyway. */
function ignoreClose(): void {
	self.addEventListener('message', function swallowClose(event: MessageEvent<{ type?: string }>) {
		if (event.data?.type === 'close') event.stopImmediatePropagation()
	})
}

/**
 * Each `destroy` told on the fixture channel, then, as the scenario shapes it, swallowed (a deaf engine),
 * handed to the engine `SLOW_DESTROY_MS` late (one still at work), at once, or the worker ended with no
 * answer (one that crashes) - by a worker that has
 * opened a project, or by one that opens nothing (the fresh worker a realm destroys through).
 */
function shapeDestroy(params: { whileOpen: DestroyShape; fresh: DestroyShape }): void {
	let opened = false
	const replayed = new WeakSet<object>()
	self.addEventListener(
		'message',
		function shapeEachDestroy(event: MessageEvent<{ type?: string; project?: string }>) {
			if (event.data?.type === 'open') opened = true
			if (event.data?.type !== 'destroy' || replayed.has(event.data)) return
			tellFixtureChannel({ type: 'destroy-asked', project: event.data.project ?? '' })
			const shape = opened ? params.whileOpen : params.fresh
			if (shape === 'at-once') return
			event.stopImmediatePropagation()
			if (shape === 'deaf') return
			if (shape === 'end') {
				self.close()
				return
			}
			const { data } = event
			replayed.add(data)
			setTimeout(function handOver() {
				self.dispatchEvent(new MessageEvent('message', { data }))
			}, SLOW_DESTROY_MS)
		},
	)
}

/** The case's orders on the fixture channel: end this worker from inside, or throw from a timer. */
function followCaseOrders(): void {
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.onmessage = function obey(event: MessageEvent<RuntimeFixtureOrder>) {
		if (event.data.type === 'end') self.close()
		if (event.data.type === 'throw-later') {
			setTimeout(function throwUncaught() {
				throw new Error('an uncaught error of a hook timer')
			}, 0)
		}
	}
}

/** Hold the first pool file of a project on `hold`, let it go on `release`; answer each with its type. */
function serveHolder(): void {
	let held: { close: () => void } | undefined
	self.addEventListener(
		'message',
		async function holdOrRelease(event: MessageEvent<RuntimeFixtureMessage>) {
			if (event.data.type === 'hold') {
				let directory = await navigator.storage.getDirectory()
				for (const name of [
					...poolDirectoryOf({ project: event.data.project }).split('/'),
					OPAQUE_DIRECTORY,
				]) {
					directory = await directory.getDirectoryHandle(name)
				}
				for await (const handle of directory.values()) {
					if (handle.kind !== 'file') continue
					held = await (handle as SyncAccessFileHandle).createSyncAccessHandle()
					self.postMessage({ type: 'held', file: handle.name })
					return
				}
			}
			held?.close()
			held = undefined
			self.postMessage({ type: 'released' })
		},
	)
}

// last: every function and the fixture dialecte above are defined by now
if (scenario === 'holder') serveHolder()
else if (scenario === 'progress-beat') serveProgressBeat()
else serveEngine()
