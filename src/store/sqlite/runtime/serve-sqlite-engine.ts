import { refuseUnnamableProject } from '../../project-name'
import { openSqliteEngine } from '../engine/sqlite-engine'
import { loadSqlite } from '../load-sqlite'
import { refuseAnotherDialecte } from '../served/dialecte-refusal'
import { serveClient } from '../served/host/engine-wire'
import { createHeartbeat, runToldBusy, withOpaquePhases } from '../served/host/heartbeat'
import { ENGINE_HEARTBEAT_INTERVAL_MS } from '../served/host/host.constants'
import { createStoreEvents } from '../served/host/store-events'
import { toThrownData } from '../served/wire/error-envelope'
import { ENGINE_WIRE_PROTOCOL } from '../served/wire/wire.constants'
import { closeEngine, endEngineAndClients, releasePool } from './close-engine'
import {
	destroyPool,
	explainOutOfSpace,
	openPool,
	probePausedPool,
	refuseShortSpace,
	takeEngineLock,
} from './install-pool'
import { installProgressBeat } from './progress-beat'
import { POOL_FILE, PROGRESS_BEAT_OPS } from './runtime.constants'

import { createDialecteError } from '@/errors'

import type { EngineControlAnswer, EngineControlRequest } from '../served/engine.types'
import type { EngineDialecte } from '../served/host/host.types'
import type { EngineRuntimeState, SqliteEngineSettings } from './runtime.types'
import type {
	AnswerEngineControl,
	ServeSqliteEngineParams,
	SqliteEngineDialecte,
} from './serve-sqlite-engine.types'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/**
 * What answers an engine worker's control messages: the SQLite engine on the origin's private file system
 * (opfs-sahpool), and the state of the one project this worker serves. The realm that spawned it (or the hub,
 * through it) sends them - open the project, adopt a client's port, a client gone, close, destroy -, each answered
 * once; every adopted port is served the engine's members. `runEngineControlLoop` hands them one at a time.
 */
export function createSqliteEngineControl(params: ServeSqliteEngineParams): AnswerEngineControl {
	const { dialectes } = params
	const state: EngineRuntimeState = {
		project: undefined,
		dialecteId: undefined,
		pool: undefined,
		releaseLock: undefined,
		engine: undefined,
		events: undefined,
		heartbeat: undefined,
		clients: new Map(),
	}
	return function answerInState(request) {
		return answerControl({ dialectes, state, request })
	}
}

/**
 * The dialecte a control message names, as the engine runs it: the first declaration of that id. An id not given,
 * or a given one at another version, is refused here: no lock taken, no file touched.
 */
function dialecteAsked(params: {
	dialectes: readonly SqliteEngineDialecte[]
	project: string
	asked: { dialecteId: string; dialecteVersion?: string }
}): EngineDialecte {
	const { dialectes, project, asked } = params
	const declaration = dialectes.find((given) => given.id === asked.dialecteId)
	if (!declaration) {
		const engineDialecteIds = dialectes.map((given) => given.id)
		throw createDialecteError('PROJECT_DIALECTE_MISMATCH', {
			detail: `"${project}" was asked as ${asked.dialecteId} of an engine worker given ${engineDialecteIds.join(', ')}: nothing was opened or removed`,
			meta: { project, realmDialecteId: asked.dialecteId, engineDialecteIds },
		})
	}
	refuseAnotherDialecte({
		project,
		engine: { dialecteId: declaration.id, dialecteVersion: declaration.version },
		asked,
	})
	return engineDialecteOf({ declaration })
}

/** A declaration erased to the config-agnostic shape the engine imports with, at this one boundary. */
function engineDialecteOf(params: { declaration: SqliteEngineDialecte }): EngineDialecte {
	const { declaration } = params
	return {
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
}

/**
 * One project per worker, a project being a dialecte and a name: a worker holding one, its engine open or its pool
 * paused, refuses any other before its engine or its files are touched, and before any lock is asked.
 */
function refuseAnotherProject(params: {
	state: EngineRuntimeState
	dialecte: EngineDialecte
	project: string
}): void {
	const { state, dialecte, project } = params
	if (state.project === undefined) return
	if (state.project === project && state.dialecteId === dialecte.id) return
	throw createDialecteError('ASSERTION_FAILED', {
		detail: `This engine worker serves project "${state.project}" of ${state.dialecteId}, not "${project}" of ${dialecte.id}: one project per worker`,
	})
}

async function answerControl(params: {
	dialectes: readonly SqliteEngineDialecte[]
	state: EngineRuntimeState
	request: EngineControlRequest<SqliteEngineSettings>
}): Promise<void> {
	const { dialectes, state, request } = params
	const { requestId } = request
	let answer: EngineControlAnswer
	try {
		switch (request.type) {
			case 'open': {
				const dialecte = dialecteAsked({ dialectes, project: request.project, asked: request })
				const { resumed } = await openEngine({ dialecte, state, request })
				answer = {
					type: 'opened',
					requestId,
					dialecteId: dialecte.id,
					dialecteVersion: dialecte.version,
					creationId: openedEngine({ state }).engine.creationId,
					wireProtocol: ENGINE_WIRE_PROTOCOL,
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
				const dialecte = dialecteAsked({ dialectes, project: request.project, asked: request })
				await destroyProject({ dialecte, state, request })
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
		expectedCreationId,
		perf,
		heartbeatIntervalMs = ENGINE_HEARTBEAT_INTERVAL_MS,
		settings: { wasmUrl, options, progressBeatOps = PROGRESS_BEAT_OPS },
	} = request
	// a name no directory can be named after is refused before the lock is asked: a refusal holds nothing
	refuseUnnamableProject({ project, dialecteId: dialecte.id })
	refuseAnotherProject({ state, dialecte, project })
	if (state.engine) {
		throw createDialecteError('ASSERTION_FAILED', {
			detail: `The engine of project "${state.project}" is open already`,
		})
	}
	const sqlite3 = await loadSqlite({ wasmUrl })
	const resumed = state.pool !== undefined
	if (state.pool) {
		// closed earlier in this worker: its pool paused, checked again and taken back under the lock (no install);
		// one budget for the wait for the lock and the probe together
		const deadline = performance.now() + budgetMs
		const lockHeld = await takeEngineLock({
			dialecteId: dialecte.id,
			project,
			mode: lock,
			deadline,
		})
		state.releaseLock = lockHeld.release
		try {
			await probePausedPool({ dialecteId: dialecte.id, project, deadline, expectedCreationId })
			await state.pool.unpauseVfs()
		} catch (thrown) {
			await releasePool({ state })
			throw thrown
		}
	} else {
		const opened = await openPool({
			sqlite3,
			dialecteId: dialecte.id,
			project,
			lock,
			budgetMs,
			expectedCreationId,
		})
		state.pool = opened.pool
		state.releaseLock = opened.lock.release
	}
	state.project = project
	state.dialecteId = dialecte.id
	let db: Database | undefined
	try {
		// made before the database opens: a dialecte failing to make its hooks leaves no file open
		const heartbeat = createHeartbeat({
			intervalMs: heartbeatIntervalMs,
			tellControl: tellRealm,
		})
		// the dialecte's hooks made once per engine (no hook state shared with a page), their long phases told
		const made = dialecte.createRuntime({ perf })
		const runtime = { ...made, hooks: withOpaquePhases({ hooks: made.hooks, heartbeat }) }
		state.heartbeat = heartbeat
		state.events = createStoreEvents({ ports: clientPortsOf({ state }) })
		db = new state.pool!.OpfsSAHPoolDb(POOL_FILE)
		installProgressBeat({ sqlite3, db, heartbeat, ops: progressBeatOps })
		state.engine = openSqliteEngine({
			sqlite3,
			db,
			dialecteId: dialecte.id,
			expectedCreationId,
			name: project,
			runtime,
			options,
			ensureImportSpace: function ensureImportSpace({ bytes }) {
				return refuseShortSpace({ project, bytes })
			},
			onWork: heartbeat.beat,
			onLongStatement: function longStatementToldBusy({ work }) {
				return runToldBusy({ heartbeat, work })
			},
			explainIoFailure: function explainIoFailure({ thrown }) {
				return explainOutOfSpace({ project, thrown })
			},
			// a connection is not reopened in place: the worker ends, its clients find their host gone, and the next
			// engine starts on the file
			onBroken: function endBrokenWorker() {
				void closeEngine({ state })
					.catch(function endAnyway() {
						// the engine was closed already: what letting it go fails on changes nothing for the worker's end
					})
					.finally(function endWorker() {
						self.close()
					})
			},
		})
		return { resumed }
	} catch (thrown) {
		// the engine closes its database when its start fails; one never handed to it is closed here
		if (db?.isOpen()) db.close()
		await releasePool({ state })
		throw thrown
	}
}

/** A sign of the engine's life told the realm that runs it, beside the control answers. */
function tellRealm(message: { type: string }): void {
	self.postMessage(message)
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

/**
 * The project removed: its engine closed when open, the lock held (taken when no engine held it), the
 * pool removed and its directory checked gone; the lock released whatever happened. A destroy that
 * fails before the removal starts keeps the pool, paused as a close leaves it: the worker may open the
 * project again.
 */
async function destroyProject(params: {
	dialecte: EngineDialecte
	state: EngineRuntimeState
	request: Extract<EngineControlRequest<SqliteEngineSettings>, { type: 'destroy' }>
}): Promise<void> {
	const { dialecte, state, request } = params
	const { project, lock, budgetMs } = request
	// a name no directory can be named after is refused before the lock is asked: a refusal holds nothing
	refuseUnnamableProject({ project, dialecteId: dialecte.id })
	refuseAnotherProject({ state, dialecte, project })
	const deadline = performance.now() + budgetMs
	let removing = false
	try {
		await endEngineAndClients({ state })
		if (!state.releaseLock) {
			// what closing the engine spent is not given again
			const held = await takeEngineLock({
				dialecteId: dialecte.id,
				project,
				mode: lock,
				deadline,
			})
			state.releaseLock = held.release
		}
		removing = true
		await destroyPool({ dialecteId: dialecte.id, project, pool: state.pool, deadline })
	} finally {
		if (removing) {
			state.pool = undefined
			state.project = undefined
			state.dialecteId = undefined
		}
		// the lock let go whatever the destroy did: a hub keeps this worker alive for the next engine
		await releasePool({ state })
	}
}

/** The ports of the clients the engine serves now: each change is told on every one. */
function clientPortsOf(params: { state: EngineRuntimeState }): () => Iterable<MessagePort> {
	const { state } = params
	return function servedPorts() {
		return [...state.clients.values()].map(function portOf(served) {
			return served.port
		})
	}
}
