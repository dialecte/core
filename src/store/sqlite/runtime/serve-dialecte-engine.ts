import { serveClient } from '../../engine/host/engine-wire'
import { createHeartbeat, runToldBusy, withOpaquePhases } from '../../engine/host/heartbeat'
import {
	CLIENT_DRAIN_BUDGET_MS,
	ENGINE_HEARTBEAT_INTERVAL_MS,
} from '../../engine/host/host.constants'
import { createStoreEvents } from '../../engine/host/store-events'
import { yieldToMessages } from '../../engine/message-turn'
import { toThrownData } from '../../engine/wire/error-envelope'
import { openSqliteEngine } from '../engine/sqlite-engine'
import { loadSqlite } from '../load-sqlite'
import { destroyPool, openPool, refuseShortSpace, takeEngineLock } from './install-pool'
import { installProgressBeat } from './progress-beat'
import { POOL_FILE, PROGRESS_BEAT_OPS } from './runtime.constants'

import { createDialecteError } from '@/errors'

import type { EngineControlAnswer, EngineControlRequest } from '../../engine/engine.types'
import type { EngineDialecte } from '../../engine/host/host.types'
import type { EngineRuntimeState, SqliteEngineSettings } from './runtime.types'
import type { DialecteDeclaration } from '@/dialecte'
import type { ExtensionModules } from '@/document'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/**
 * Serve the dialecte's engine from this worker - today the SQLite engine on the origin's private file
 * system (opfs-sahpool), its client side engine-agnostic (`store/engine`). The realm that spawned it (or
 * the hub, through it) sends control messages - open the project, adopt a client's port, a client gone, close, destroy -
 * handled one at a time and each answered once; every adopted port is served the engine's members.
 * One project per worker.
 */
export function serveDialecteEngine<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules,
	GenericConfigKey extends string,
>(params: {
	dialecte: DialecteDeclaration<GenericConfig, GenericModules, GenericConfigKey>
}): void {
	const { dialecte: declaration } = params
	// erased to the config-agnostic shape the engine imports with, at this one boundary
	const dialecte: EngineDialecte = {
		id: declaration.id,
		version: declaration.version,
		createRuntime: function createRuntime({ perf }) {
			return {
				configs: declaration.configs as Record<string, AnyDialecteConfig>,
				defaultConfigKey: declaration.defaultConfigKey,
				hooks: declaration.createHooks() as DialecteHooks<AnyDialecteConfig>,
				perf,
			}
		},
	}
	const state: EngineRuntimeState = {
		project: undefined,
		pool: undefined,
		releaseLock: undefined,
		engine: undefined,
		events: undefined,
		heartbeat: undefined,
		clients: new Map(),
	}
	// an uncaught error of the dialecte's code (a hook's timer) is told on this worker's console only:
	// the engine goes on, and the realm that spawned it never takes it for the engine's end
	self.addEventListener('error', function keepUncaughtError(event: ErrorEvent) {
		console.error('Uncaught in the project engine:', event.error ?? event.message)
		event.preventDefault()
	})
	let turn: Promise<void> = Promise.resolve()
	self.addEventListener('message', function takeControl(event: MessageEvent<unknown>) {
		const request = event.data
		// not a control message (no object, no request id): another listener's, or nothing
		if (!isControlRequest(request)) return
		// one control message at a time, in the order sent: an open is done before a client is adopted
		turn = turn
			.then(function handleInTurn() {
				return answerControl({ dialecte, state, request })
			})
			.catch(function keepServing(thrown: unknown) {
				console.error('The project engine could not answer a control message:', thrown)
			})
	})
}

async function answerControl(params: {
	dialecte: EngineDialecte
	state: EngineRuntimeState
	request: EngineControlRequest<SqliteEngineSettings>
}): Promise<void> {
	const { dialecte, state, request } = params
	const { requestId } = request
	let answer: EngineControlAnswer
	try {
		switch (request.type) {
			case 'open': {
				const { resumed } = await openEngine({ dialecte, state, request })
				answer = {
					type: 'opened',
					requestId,
					dialecteId: dialecte.id,
					dialecteVersion: dialecte.version,
					resumed,
				}
				break
			}
			case 'adopt-client': {
				const { engine, events, heartbeat } = openedEngine({ state })
				heartbeat.add(request.port)
				const served = serveClient({
					port: request.port,
					clientId: request.clientId,
					view: engine.clientView({ clientId: request.clientId }),
					events,
					heartbeat,
				})
				state.clients.set(request.clientId, served)
				answer = { type: 'adopted', requestId }
				break
			}
			case 'client-gone': {
				state.engine?.abortImportsOf({ clientId: request.clientId })
				state.engine?.abortExportsOf({ clientId: request.clientId })
				const served = state.clients.get(request.clientId)
				if (served) state.heartbeat?.remove(served.port)
				served?.port.close()
				state.clients.delete(request.clientId)
				answer = { type: 'released', requestId }
				break
			}
			case 'close': {
				await closeEngine({ state })
				answer = { type: 'closed', requestId }
				break
			}
			case 'destroy': {
				await destroyProject({ state, request })
				answer = { type: 'destroyed', requestId }
				break
			}
			default:
				// not a control message of the engine's
				return
		}
	} catch (thrown) {
		answer = { type: 'failed', requestId, thrown: toThrownData({ thrown }) }
	}
	self.postMessage(answer)
}

/**
 * The project opened: the pool installed under the engine lock (or resumed in this worker after a
 * close), the database opened on it, the engine started with the dialecte's configs and its own
 * hooks. A failure after the lock was taken closes what was opened and releases the lock.
 */
async function openEngine(params: {
	dialecte: EngineDialecte
	state: EngineRuntimeState
	request: Extract<EngineControlRequest<SqliteEngineSettings>, { type: 'open' }>
}): Promise<{ resumed: boolean }> {
	const { dialecte, state, request } = params
	const {
		project,
		lock,
		budgetMs,
		perf,
		heartbeatIntervalMs = ENGINE_HEARTBEAT_INTERVAL_MS,
		settings: { wasmUrl, options, progressBeatOps = PROGRESS_BEAT_OPS },
	} = request
	if (state.engine) {
		throw createDialecteError('ASSERTION_FAILED', {
			detail: `The engine of project "${state.project}" is open already`,
		})
	}
	if (state.project !== undefined && state.project !== project) {
		throw createDialecteError('ASSERTION_FAILED', {
			detail: `This engine worker serves project "${state.project}", not "${project}": one project per worker`,
		})
	}
	const sqlite3 = await loadSqlite({ wasmUrl })
	const resumed = state.pool !== undefined
	if (state.pool) {
		// closed earlier in this worker: its pool paused, taken back under the lock (no install)
		const lockHeld = await takeEngineLock({ project, mode: lock, budgetMs })
		state.releaseLock = lockHeld.release
		try {
			await state.pool.unpauseVfs()
		} catch (thrown) {
			releasePool({ state })
			throw thrown
		}
	} else {
		const opened = await openPool({ sqlite3, project, lock, budgetMs })
		state.pool = opened.pool
		state.releaseLock = opened.lock.release
	}
	state.project = project
	let db: Database | undefined
	try {
		// made before the database opens: a dialecte failing to make its hooks leaves no file open
		const heartbeat = createHeartbeat({ intervalMs: heartbeatIntervalMs })
		// the dialecte's hooks made once per engine (no hook state shared with a page), their long phases told
		const made = dialecte.createRuntime({ perf })
		const runtime = { ...made, hooks: withOpaquePhases({ hooks: made.hooks, heartbeat }) }
		state.heartbeat = heartbeat
		state.events = createStoreEvents({ project })
		db = new state.pool!.OpfsSAHPoolDb(POOL_FILE)
		installProgressBeat({ sqlite3, db, heartbeat, ops: progressBeatOps })
		state.engine = openSqliteEngine({
			sqlite3,
			db,
			dialecteId: dialecte.id,
			name: project,
			runtime,
			options,
			ensureImportSpace: function ensureImportSpace({ bytes }) {
				return refuseShortSpace({ project, bytes })
			},
			onWork: heartbeat.beat,
			onLongStatement: function longStatementToldBusy(work) {
				return runToldBusy({ heartbeat, work })
			},
		})
		return { resumed }
	} catch (thrown) {
		// the engine closes its database when its start fails; one never handed to it is closed here
		if (db?.isOpen()) db.close()
		releasePool({ state })
		throw thrown
	}
}

/** The engine open in this worker, with the channel it announces on; none open is a caller's mistake. */
function openedEngine(params: { state: EngineRuntimeState }): {
	engine: NonNullable<EngineRuntimeState['engine']>
	events: NonNullable<EngineRuntimeState['events']>
	heartbeat: NonNullable<EngineRuntimeState['heartbeat']>
} {
	const { engine, events, heartbeat } = params.state
	if (engine && events && heartbeat) return { engine, events, heartbeat }
	throw createDialecteError('ASSERTION_FAILED', {
		detail: 'No project is open in this engine worker',
	})
}

/** Every import and export aborted, the database closed, the pool paused (its files kept), the lock released. */
async function closeEngine(params: { state: EngineRuntimeState }): Promise<void> {
	const { state } = params
	await endEngineAndClients({ state })
	releasePool({ state })
}

/**
 * The engine closed (every import and export aborted), then each client port closed once the calls it
 * was asked have answered (an aborted import answers `IMPORT_ABORTED`), within `CLIENT_DRAIN_BUDGET_MS`.
 */
async function endEngineAndClients(params: { state: EngineRuntimeState }): Promise<void> {
	const { state } = params
	state.engine?.close()
	state.engine = undefined
	const clients = [...state.clients.values()]
	state.clients.clear()
	let budget: ReturnType<typeof setTimeout> | undefined
	await Promise.race([
		Promise.all(clients.map((client) => client.drained())),
		new Promise(function waitDrainBudget(resolve) {
			budget = setTimeout(resolve, CLIENT_DRAIN_BUDGET_MS)
		}),
	])
	clearTimeout(budget)
	// the answers posted first: a port closed a turn later never loses one
	await yieldToMessages()
	for (const client of clients) client.port.close()
	state.events?.close()
	state.events = undefined
	state.heartbeat = undefined
}

/** The pool paused and the lock released whatever the pause does: the files stay, another engine may open them. */
function releasePool(params: { state: EngineRuntimeState }): void {
	const { state } = params
	state.events?.close()
	state.events = undefined
	state.heartbeat = undefined
	try {
		state.pool?.pauseVfs()
	} finally {
		state.releaseLock?.()
		state.releaseLock = undefined
	}
}

/**
 * The project removed: its engine closed when open, the lock held (taken when no engine held it), the
 * pool removed and its directory checked gone; the lock released whatever happened.
 */
async function destroyProject(params: {
	state: EngineRuntimeState
	request: Extract<EngineControlRequest<SqliteEngineSettings>, { type: 'destroy' }>
}): Promise<void> {
	const { state, request } = params
	const { project, lock, budgetMs } = request
	await endEngineAndClients({ state })
	if (!state.releaseLock) {
		const held = await takeEngineLock({ project, mode: lock, budgetMs })
		state.releaseLock = held.release
	}
	try {
		await destroyPool({ project, pool: state.pool })
	} finally {
		state.pool = undefined
		state.project = undefined
		state.releaseLock?.()
		state.releaseLock = undefined
	}
}

/** A control message of the engine's: an object with a type and a request id (a type guard: one value). */
function isControlRequest(request: unknown): request is EngineControlRequest<SqliteEngineSettings> {
	return (
		typeof request === 'object' &&
		request !== null &&
		typeof (request as { type?: unknown }).type === 'string' &&
		typeof (request as { requestId?: unknown }).requestId === 'number'
	)
}
