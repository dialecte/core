import { createOpenConnections } from '../../open-connections'
import { refuseUnnamableProject } from '../../project-name'
import { throwOpenElsewhere } from '../../store-errors'
import { refuseOtherCreation } from '../creation-refusal'
import { refuseAnotherDialecte } from '../dialecte-refusal'
import { engineLockNameOf, projectKeyOf } from '../project-key'
import { refuseAnotherWire } from './check-engine-wire'
import {
	ENGINE_CLOSE_BUDGET_MS,
	ENGINE_FOLLOW_REARM_FIRST_MS,
	ENGINE_FOLLOW_REARM_MAX_MS,
	ENGINE_HEARTBEAT_TIMEOUT_MS,
	ENGINE_OPEN_BUDGET_MS,
	ENGINE_OPEN_WINDOW_MS,
	ENGINE_LOST_DETAILS,
	UNANSWERED,
} from './client.constants'
import { createEngineClient } from './engine-client'
import { answeredOrSilent, createEngineControl } from './engine-control'

import { createDialecteError, toDialecteError } from '@/errors'
import { throwStoreClosed } from '@/store/store-errors'
import { tellListeners } from '@/utils/tell-listener'
import { TOLD_OF } from '@/utils/tell-listener.constants'

import type { EngineConnector, EngineLink, LinkNotice, OwnEngineLink } from '../engine-store.types'
import type { EngineApi, EngineLockMode } from '../engine.types'
import type {
	EngineClient,
	EngineControl,
	EngineEnding,
	FreshWorkerDestroy,
	RealmEngine,
	WorkerConnectorParams,
	WorkerLinkState,
} from './client.types'

/** The engine worker this realm runs for each project, by its key (`projectKeyOf`: direct mode, one per project). */
const ENGINES = new Map<string, RealmEngine>()
/** The engines of a project still closing or being destroyed, by its key: the next one of the project waits for them. */
const ENDING = new Map<string, Promise<void>>()
/** Numbers every engine the realm starts: a connection adopted by an engine since gone adopts again. */
const generations = { next: 0 }
/** The connections of this realm to each project, by its key, from their connect until closed: a destroy is refused while one is. */
const OPEN_LINKS = createOpenConnections()
/** The connection each link a store holds is counted as: its own destroy counts the others without it. */
const LINK_STATES = new WeakMap<EngineLink, WorkerLinkState>()

/**
 * Direct mode: the project's engine runs in a dedicated worker this realm spawns (from the dialecte's
 * engine address), shared by every connection of the realm to the name, each through a port of its
 * own. The engine takes the project's lock only if free: another realm holding it refuses with
 * `PROJECT_OPEN_ELSEWHERE`. The worker is closed and ended with the last connection.
 */
export function createWorkerConnector<GenericSettings>(
	params: WorkerConnectorParams<GenericSettings>,
): EngineConnector {
	refuseUnnamableProject({ project: params.name, dialecteId: params.dialecteId })
	return {
		connect: function connectToWorker() {
			return linkToEngine(params)
		},
		destroy: function destroyThroughFreshWorker(destroyParams) {
			return destroyProject({ connector: params, own: destroyParams?.own })
		},
	}
}

async function linkToEngine(params: WorkerConnectorParams<unknown>): Promise<EngineLink> {
	const openBudgetMs = params.openBudgetMs ?? ENGINE_OPEN_BUDGET_MS
	const state: WorkerLinkState = {
		clientId: crypto.randomUUID(),
		released: false,
		listeners: new Set(),
		follow: followNothing,
		mayFollow: true,
		followedAt: undefined,
		followRearmMs: ENGINE_FOLLOW_REARM_FIRST_MS,
		adoption: undefined,
		creationId: undefined,
		refusal: undefined,
		releasing: undefined,
	}
	const key = keyOf(params)
	OPEN_LINKS.markOpen({ name: key, connection: state })
	await runningEngine({ connector: params, link: state }).catch(function forgetFailedLink(
		thrown: unknown,
	) {
		OPEN_LINKS.markClosed({ name: key, connection: state })
		throw thrown
	})
	/** The engine the connection reaches now, adopted when it is another one than the one it had. */
	async function reach(): Promise<EngineApi> {
		if (state.released) throwStoreClosed({ storeName: params.name })
		const engine = await runningEngine({ connector: params, link: state })
		if (state.adoption?.generation !== engine.generation) {
			// the client of an engine gone since is let go: its port, its watch, its page listeners
			releaseSupersededClient({ adoption: state.adoption, storeName: params.name })
			// another engine than the one the connection had: what changed between the two was told to no one here
			const another = state.adoption !== undefined
			state.adoption = {
				generation: engine.generation,
				client: adoptClient({
					name: params.name,
					dialecteId: params.dialecteId,
					engine,
					state,
					heartbeatTimeoutMs: params.liveness?.heartbeatTimeoutMs,
					openBudgetMs,
				}).then(function listenToEngine(client) {
					client.onEvent(function tellListeners(signal) {
						tellLink({ state, notice: { type: 'event', signal } })
					})
					if (another) tellLink({ state, notice: { type: 'resync' } })
					return client
				}),
			}
		}
		const client = await state.adoption.client
		return client.api
	}
	const link: EngineLink = {
		engine: function currentEngine() {
			// a call of the connection's own: once it ended, a lost engine may be followed again
			state.mayFollow = true
			state.followRearmMs = ENGINE_FOLLOW_REARM_FIRST_MS
			return reach()
		},
		connectionId: state.clientId,
		onNotice: function listen(listener) {
			if (state.released) return followNothing
			state.listeners.add(listener)
			return function stopListening() {
				state.listeners.delete(listener)
			}
		},
		close: function releaseLink() {
			// closed already: settled with that first close
			state.releasing ??= releaseConnection()
			return state.releasing
		},
	}
	state.follow = function followNextEngine() {
		// once after each call of its own, and again once the engine it followed lasted (a while longer each time): an
		// idle connection hears every engine that lasts, one that does not is not started again and again for it
		const lasted =
			state.followedAt !== undefined && performance.now() - state.followedAt >= state.followRearmMs
		if (state.released || state.listeners.size === 0 || !(state.mayFollow || lasted)) return
		if (lasted) state.followRearmMs = Math.min(state.followRearmMs * 2, ENGINE_FOLLOW_REARM_MAX_MS)
		state.mayFollow = false
		state.followedAt = undefined
		reach().then(
			function followed() {
				state.followedAt = performance.now()
			},
			function notReached() {
				// no engine now (refused, closed meanwhile): the next call says why
			},
		)
	}
	/** The connection released: counted no more, its engine closed when it was the last one. */
	async function releaseConnection(): Promise<void> {
		state.released = true
		state.listeners.clear()
		OPEN_LINKS.markClosed({ name: key, connection: state })
		const engine = ENGINES.get(key)
		releaseClient({ engine, state, storeName: params.name })
		if (!engine?.links.delete(state)) {
			// not counted on a running engine: the realm ended the one it had (an adoption never answered, its project
			// destroyed while it was away) - settled once that engine let the project's lock go
			await ENDING.get(key)
			return
		}
		if (engine.links.size > 0) return
		// the last connection: settled once its engine let the project's lock go (another tab may destroy it)
		await closeEngine({ name: params.name, dialecteId: params.dialecteId, engine, openBudgetMs })
	}
	LINK_STATES.set(link, state)
	return link
}

/**
 * The realm's engine of the name, started first when none runs (once any of the name has ended), the
 * connection counted on it from now: its close closes an engine still opening as it closes one open. A
 * connection closed starts none, and gets none it was waiting for: refused `STORE_CLOSED`.
 */
async function runningEngine(params: {
	connector: WorkerConnectorParams<unknown>
	link: WorkerLinkState
}): Promise<RealmEngine> {
	const { connector, link } = params
	const { name } = connector
	const key = keyOf(connector)
	await ENDING.get(key)
	if (link.released) throwStoreClosed({ storeName: name })
	// its project destroyed while it was away: every later call refused so, no engine started for it
	if (link.refusal !== undefined) throw link.refusal
	let engine = ENGINES.get(key)
	if (!engine) {
		// a connection coming back to its project tells the engine which one it had: none made in its place
		engine = spawnEngine({ connector, expectedCreationId: link.creationId })
		ENGINES.set(key, engine)
	}
	engine.links.add(link)
	try {
		await engine.opened
	} catch (thrown) {
		engine.links.delete(link)
		if (ENGINES.get(key) === engine) ENGINES.delete(key)
		// an engine another connection started expecting its project refused it: this one expects none
		const destroyedWhileAway = toDialecteError(thrown)?.key === 'PROJECT_DESTROYED_WHILE_AWAY'
		if (destroyedWhileAway && link.creationId === undefined) return runningEngine(params)
		if (destroyedWhileAway) link.refusal = thrown
		throw thrown
	}
	if (link.released) throwStoreClosed({ storeName: name })
	// the project this connection had was destroyed while it was away, and made again since
	try {
		refuseOtherCreation({
			project: name,
			expectedCreationId: link.creationId,
			creationId: engine.creationId,
		})
	} catch (refusal) {
		link.refusal = refusal
		// its last connection gone with this one: the engine closes, as with a connection closed
		if (engine.links.delete(link) && engine.links.size === 0 && !engine.ended) {
			void closeEngine({
				name,
				dialecteId: connector.dialecteId,
				engine,
				openBudgetMs: connector.openBudgetMs ?? ENGINE_OPEN_BUDGET_MS,
			})
		}
		throw refusal
	}
	link.creationId = engine.creationId
	return engine
}

/**
 * A worker for the project; opened, it is watched through the engine lock. One silent past the open window
 * is ended, the open refused `PROJECT_ENGINE_UNAVAILABLE`.
 */
function spawnEngine(params: {
	connector: WorkerConnectorParams<unknown>
	/** The creation id the connection starting it knows of the project (coming back to it). */
	expectedCreationId: string | undefined
}): RealmEngine {
	const { connector, expectedCreationId } = params
	const {
		name,
		dialecteId,
		dialecteVersion,
		engineUrl,
		perf = false,
		openBudgetMs = ENGINE_OPEN_BUDGET_MS,
		liveness = {},
		settings,
	} = connector
	// never shorter than the engine's own budget and the time to answer
	const openWindowMs = Math.max(
		connector.openWindowMs ?? ENGINE_OPEN_WINDOW_MS,
		openBudgetMs + ENGINE_CLOSE_BUDGET_MS,
	)
	const worker = new Worker(engineUrl, { type: 'module' })
	const control = createEngineControl({ worker })
	generations.next += 1
	const engine: RealmEngine = {
		worker,
		generation: generations.next,
		opened: Promise.resolve(),
		control,
		links: new Set(),
		ended: false,
		watch: undefined,
		creationId: undefined,
	}
	const opening = control.request({
		message: {
			type: 'open',
			project: name,
			dialecteId,
			dialecteVersion,
			expectedCreationId,
			lock: 'if-available',
			budgetMs: openBudgetMs,
			perf,
			heartbeatIntervalMs: liveness.heartbeatIntervalMs,
			settings,
		},
		expect: 'opened',
	})
	engine.opened = withinBudget({ work: opening, budgetMs: openWindowMs })
		.then(function checkAnswer(answer) {
			if (answer === UNANSWERED) {
				// ended already (its last connection closed meanwhile): ending its own way
				if (!engine.ended) {
					endEngine({
						name,
						dialecteId,
						engine,
						worker,
						ending: Promise.resolve(UNANSWERED),
						lockBudgetMs: openBudgetMs,
					})
				}
				throw createDialecteError('PROJECT_ENGINE_UNAVAILABLE', {
					detail: `The engine of project "${name}" gave no answer to its open within ${openWindowMs} ms: it was ended`,
					meta: { project: name, openWindowMs },
				})
			}
			engine.creationId = answer.creationId
			try {
				refuseAnotherWire({ found: answer.wireProtocol })
				// an engine of another copy of the library may not check what it was asked: its answer is
				refuseAnotherDialecte({
					project: name,
					engine: answer,
					asked: { dialecteId, dialecteVersion },
				})
			} catch (thrown) {
				// it opened all the same, its own project's lock held: the next engine waits until it let it go
				endEngine({
					name,
					dialecteId,
					engine,
					worker,
					ending: Promise.resolve(),
					lockBudgetMs: openBudgetMs,
					lockDialecteId: answer.dialecteId,
				})
				throw thrown
			}
		})
		.then(
			function engineOpened() {
				control.opened()
				// ended meanwhile by the realm (its last connection closed while it opened): nothing to watch
				if (!engine.ended) watchEngineLock({ name, dialecteId, engine })
			},
			function endFailedEngine(thrown: unknown) {
				// one the realm ended already (silent, or its last connection closed) is ending its own way
				if (!engine.ended) {
					engine.ended = true
					control.end({ error: thrown })
					worker.terminate()
				}
				throw thrown
			},
		)
	return engine
}

/**
 * Ask for the engine's lock from this page (locks are the death signal): it is granted once the worker
 * holds it no more - it ended, or crashed - unless the realm ends the engine itself first (the request
 * is then aborted). Granted, it is let go at once.
 */
function watchEngineLock(params: { name: string; dialecteId: string; engine: RealmEngine }): void {
	const { name, dialecteId, engine } = params
	const controller = new AbortController()
	const lockName = engineLockNameOf({ dialecteId, project: name })
	const settled = navigator.locks
		.request(lockName, { signal: controller.signal }, function engineGone() {
			endLostEngine({ name, dialecteId, engine })
		})
		.then(settleNothing, settleNothing)
	engine.watch = { controller, settled }
}

/**
 * The engine gone on its own: every call in flight on it refused `STORE_ENGINE_LOST` (`host-gone`),
 * its worker ended; the next call of a connection starts another engine.
 */
function endLostEngine(params: { name: string; dialecteId: string; engine: RealmEngine }): void {
	const { name, dialecteId, engine } = params
	if (engine.ended) return
	engine.ended = true
	const key = keyOf({ name, dialecteId })
	if (ENGINES.get(key) === engine) ENGINES.delete(key)
	engine.control.end({ error: lostEngine() })
	// the next engine of the name starts once the page has let the lock go
	if (engine.watch) holdNextEngine({ key, until: engine.watch.settled })
	loseClientsOf({ engine })
	engine.worker.terminate()
}

/** Every call in flight on the engine's clients refused `STORE_ENGINE_LOST` (`host-gone`): its worker is gone. */
function loseClientsOf(params: { engine: RealmEngine }): void {
	const { engine } = params
	for (const link of engine.links) {
		if (link.adoption?.generation !== engine.generation) continue
		link.adoption.client.then(function loseClient(client) {
			client.lose({ reason: 'host-gone' })
			// a connection that listens reaches the next engine at once: no call of its own may come to do it
			queueMicrotask(link.follow)
		}, ignoreFailedAdoption)
	}
}

/** The connection's store told `notice`; a listener that throws stops no other. */
function tellLink(params: { state: WorkerLinkState; notice: LinkNotice }): void {
	tellListeners({
		listeners: params.state.listeners,
		value: params.notice,
		of: TOLD_OF.engineChanges,
	})
}

function followNothing(): void {}

/**
 * A client of its own for the connection: a new port, handed to the engine. An engine silent for the
 * heartbeat timeout while not busy is lost: ended (the calls in flight of its other clients, and their
 * adoptions, refused `STORE_ENGINE_LOST` `host-gone`, the next call starting another engine) and the
 * adoption refused `PROJECT_ENGINE_UNAVAILABLE`. A busy one - dialecte code running long - is waited for.
 */
async function adoptClient(params: {
	name: string
	dialecteId: string
	engine: RealmEngine
	state: WorkerLinkState
	heartbeatTimeoutMs: number | undefined
	openBudgetMs: number
}): Promise<EngineClient> {
	const {
		name,
		dialecteId,
		engine,
		state,
		heartbeatTimeoutMs = ENGINE_HEARTBEAT_TIMEOUT_MS,
		openBudgetMs,
	} = params
	const channel = new MessageChannel()
	const adopting = engine.control.request({
		message: { type: 'adopt-client', clientId: state.clientId, port: channel.port2 },
		expect: 'adopted',
		transfer: [channel.port2],
	})
	const answer = await answeredOrSilent({
		control: engine.control,
		work: adopting,
		budgetMs: heartbeatTimeoutMs,
	})
	if (answer === UNANSWERED) {
		channel.port1.close()
		if (!engine.ended) {
			loseClientsOf({ engine })
			// the other connections' adoptions under way: lost with the engine, not closed
			engine.control.end({ error: lostEngine() })
			endEngine({
				name,
				dialecteId,
				engine,
				worker: engine.worker,
				ending: Promise.resolve(UNANSWERED),
				lockBudgetMs: openBudgetMs,
			})
		}
		throw createDialecteError('PROJECT_ENGINE_UNAVAILABLE', {
			detail: `The engine of project "${name}" gave no answer to a new connection within ${heartbeatTimeoutMs} ms: it was ended`,
			meta: { project: name, heartbeatTimeoutMs },
		})
	}
	return createEngineClient({ port: channel.port1, heartbeatTimeoutMs })
}

/** A client of an engine that has ended: closed, nothing told to an engine that is gone. */
function releaseSupersededClient(params: {
	adoption: WorkerLinkState['adoption']
	storeName: string
}): void {
	const { adoption, storeName } = params
	adoption?.client.then(function closeClient(client) {
		client.close({ storeName })
	}, ignoreFailedAdoption)
}

/** The connection's client closed and the engine told it is gone (its imports and exports aborted). */
function releaseClient(params: {
	engine: RealmEngine | undefined
	state: WorkerLinkState
	storeName: string
}): void {
	const { engine, state, storeName } = params
	const adoption = state.adoption
	state.adoption = undefined
	if (!adoption) return
	adoption.client.then(function closeClient(client) {
		client.close({ storeName })
	}, ignoreFailedAdoption)
	if (engine?.generation !== adoption.generation || engine.ended) return
	engine.control
		.request({ message: { type: 'client-gone', clientId: state.clientId }, expect: 'released' })
		.catch(ignoreGoneEngine)
}

/**
 * The project deleted through a worker that opens nothing (a project of another layout is deleted too),
 * ended after - refused `PROJECT_OPEN_ELSEWHERE` while another connection of this realm has the project
 * open (`own`, the destroying store's own, does not count), as one of another realm is by the engine's
 * lock. Going ahead, it lets `own` go, and every connection made from then on waits for the destroy: an
 * engine of the name still closing is waited for first (its lock must be free), then the fresh worker
 * deletes.
 */
async function destroyProject(params: {
	connector: WorkerConnectorParams<unknown>
	own: OwnEngineLink | undefined
}): Promise<void> {
	const { connector, own } = params
	const { name, dialecteId, engineUrl, openBudgetMs = ENGINE_OPEN_BUDGET_MS } = connector
	const key = keyOf(connector)
	refuseWhileOpen({ name, key, own: own === undefined ? undefined : LINK_STATES.get(own.link) })
	// its engine closed with it when it was the last connection: waited for below, as any still ending
	void own?.letGo()
	const ending = ENDING.get(key)
	let destroyEnded: () => void = settleNothing
	holdNextEngine({
		key,
		until: new Promise<void>(function untilDestroyEnded(resolve) {
			destroyEnded = resolve
		}),
	})
	// what waits for this destroy - another destroy of the name too - waits for its fresh worker as the next
	// engine does: until it let the lock go, within the budget its answer gave it
	let released: Promise<void> = Promise.resolve()
	try {
		await ending
		assertNoEngine({ name, key })
		const destroying = startFreshWorkerDestroy({
			name,
			dialecteId,
			engineUrl,
			budgetMs: openBudgetMs,
			lock: 'if-available',
		})
		released = destroying.released
		await destroying.done
	} finally {
		void released.then(destroyEnded, destroyEnded)
	}
}

/**
 * Whether this realm runs the project's engine itself (a connection of it open in direct mode): a new connection
 * of the realm joins that engine, whatever the hub says by then.
 */
export function runsDirectly(params: { name: string; dialecteId: string }): boolean {
	return OPEN_LINKS.others({ name: keyOf(params) }) > 0
}

/** Refused `PROJECT_OPEN_ELSEWHERE` while a connection of this realm but `own` has the project open. */
function refuseWhileOpen(params: { name: string; key: string; own?: WorkerLinkState }): void {
	const open = OPEN_LINKS.others({ name: params.key, connection: params.own })
	if (open > 0) throwOpenElsewhere({ storeName: params.name, connections: open })
}

/**
 * No other connection open when the destroy went ahead, and none of its engines ending: the realm runs no
 * engine of the name - each one starts for a connection (one made since waits for the destroy), a closed
 * one starts none, and each is closed with its last connection, one still opening too.
 */
function assertNoEngine(params: { name: string; key: string }): void {
	if (!ENGINES.has(params.key)) return
	throw createDialecteError('ASSERTION_FAILED', {
		detail: `Project "${params.name}" has an engine in this realm with no connection open on it`,
		meta: { project: params.name },
	})
}

/**
 * A worker that opens nothing deletes the project, the lock taken as `lock` says (only if free in
 * direct mode; waited for through the hub, whose engine just released may hold it a moment); ended
 * after. It has the open budget to delete and the close budget to answer: one that does not is ended,
 * and the destroy refused `PROJECT_DESTROY_FAILED` (the project may still be there).
 */
export async function destroyFromFreshWorker(params: {
	name: string
	dialecteId: string
	engineUrl: string
	budgetMs: number
	lock: EngineLockMode
}): Promise<void> {
	await startFreshWorkerDestroy(params).done
}

/** The fresh worker's destroy started: its answer, and when the next engine of the name may start after it. */
function startFreshWorkerDestroy(params: {
	name: string
	dialecteId: string
	engineUrl: string
	budgetMs: number
	lock: EngineLockMode
}): FreshWorkerDestroy {
	const { name, dialecteId, engineUrl, budgetMs, lock } = params
	const worker = new Worker(engineUrl, { type: 'module' })
	const { ended, released } = endEngine({
		name,
		dialecteId,
		engine: undefined,
		worker,
		lockBudgetMs: budgetMs,
		ending: withinBudget({
			work: askDestroy({
				name,
				dialecteId,
				control: createEngineControl({ worker }),
				budgetMs,
				lock,
			}),
			budgetMs: budgetMs + ENGINE_CLOSE_BUDGET_MS,
		}),
	})
	const done = ended.then(function refuseUnanswered(answer) {
		if (answer !== UNANSWERED) return
		throw createDialecteError('PROJECT_DESTROY_FAILED', {
			detail: `Project "${name}" was not destroyed: its engine worker gave no answer within ${budgetMs + ENGINE_CLOSE_BUDGET_MS} ms`,
			meta: { project: name, budgetMs },
		})
	})
	return { done, released }
}

/** The engine asked to delete the project; settles once it has answered (wrapped in `withinBudget` by its callers). */
async function askDestroy(params: {
	name: string
	dialecteId: string
	control: EngineControl
	budgetMs: number
	lock: EngineLockMode
}): Promise<void> {
	const { name, dialecteId, control, budgetMs, lock } = params
	await control.request({
		message: { type: 'destroy', project: name, dialecteId, lock, budgetMs },
		expect: 'destroyed',
	})
}

/**
 * The engine told to close, then its worker ended once it has closed or the close budget has passed -
 * counted from now, an engine still opening included (only a raw connection closes one mid-open: a
 * store releases its connection once its open has settled); ended unopened, its lock is waited for.
 */
function closeEngine(params: {
	name: string
	dialecteId: string
	engine: RealmEngine
	openBudgetMs: number
}): Promise<void> {
	const { name, dialecteId, engine, openBudgetMs } = params
	const ending = endEngine({
		name,
		dialecteId,
		engine,
		worker: engine.worker,
		lockBudgetMs: openBudgetMs,
		ending: withinBudget({
			work: engine.control.request({ message: { type: 'close' }, expect: 'closed' }),
			budgetMs: ENGINE_CLOSE_BUDGET_MS,
		}),
	})
	ending.ended.catch(ignoreGoneEngine)
	return ending.released
}

/**
 * An engine the realm ends itself: its lock watch withdrawn first (its own release is no death), the
 * work asked of it awaited, then its worker ended. One that gave no answer may hold the lock a while
 * after (seconds on a loaded machine): it is waited for within `lockBudgetMs`. The next engine of the
 * name starts once all of it has settled - registered before any call on the ended engine is refused,
 * so a caller retrying at once waits for it too. Answers the work's answer, and when the next engine may start.
 */
function endEngine(params: {
	name: string
	dialecteId: string
	engine: RealmEngine | undefined
	worker: Worker
	ending: Promise<unknown>
	lockBudgetMs: number
	/** The dialecte whose lock the worker may hold, when it runs another than the one asked (its own answer). */
	lockDialecteId?: string
}): EngineEnding {
	const { name, dialecteId, engine, worker, ending, lockBudgetMs } = params
	const lockDialecteId = params.lockDialecteId ?? dialecteId
	const key = keyOf({ name, dialecteId })
	if (engine) {
		engine.ended = true
		if (ENGINES.get(key) === engine) ENGINES.delete(key)
		engine.watch?.controller.abort()
	}
	let deaf = false
	const ended = ending.then(
		function terminateWorker(answer: unknown) {
			endWorker({ unanswered: answer === UNANSWERED })
			return answer
		},
		function terminateAfterFailure(thrown: unknown) {
			endWorker({ unanswered: false })
			throw thrown
		},
	)
	function endWorker(outcome: { unanswered: boolean }): void {
		deaf = outcome.unanswered
		engine?.control.end({ error: endedByRealm({ name }) })
		worker.terminate()
	}
	const lockFree = ended.then(settleNothing, settleNothing).then(function waitForLock() {
		return untilLockFree({
			name,
			dialecteId: lockDialecteId,
			budgetMs: deaf ? lockBudgetMs : ENGINE_CLOSE_BUDGET_MS,
		})
	})
	const released = Promise.all([lockFree, engine?.watch?.settled]).then(settleNothing)
	holdNextEngine({ key, until: released })
	return { ended, released }
}

/**
 * The page granted the engine's lock (let go at once): its last holder in this realm let it go - true;
 * or the budget passed - false (another realm's engine may hold it: the next open answers that).
 */
function untilLockFree(params: {
	name: string
	dialecteId: string
	budgetMs: number
}): Promise<boolean> {
	return navigator.locks
		.request(
			engineLockNameOf({ dialecteId: params.dialecteId, project: params.name }),
			{ signal: AbortSignal.timeout(params.budgetMs) },
			settleNothing,
		)
		.then(lockGranted, lockNotGranted)
}

function lockGranted(): boolean {
	return true
}

function lockNotGranted(): boolean {
	return false
}

/** The next engine of the project (its key) waits until `until` has settled (and whatever it waited for before). */
function holdNextEngine(params: { key: string; until: Promise<void> }): void {
	const { key, until } = params
	const settled = Promise.all([ENDING.get(key), until]).then(settleNothing)
	ENDING.set(key, settled)
	void settled.then(function forgetEnding() {
		if (ENDING.get(key) === settled) ENDING.delete(key)
	})
}

/** What a call answers once its engine is gone (`host-gone`): the next call starts another engine. */
function lostEngine(): Error {
	return createDialecteError('STORE_ENGINE_LOST', {
		detail: ENGINE_LOST_DETAILS['host-gone'],
		meta: { reason: 'host-gone' },
	})
}

/** What a request to an engine the realm ended answers: the store is closed. */
function endedByRealm(params: { name: string }): Error {
	return createDialecteError('STORE_CLOSED', {
		detail: `The engine of project "${params.name}" was ended`,
		meta: { storeName: params.name },
	})
}

/** `work`, or `UNANSWERED` once `budgetMs` has passed (the timer cleared when the work ends first). */
function withinBudget<GenericAnswer>(params: {
	work: Promise<GenericAnswer>
	budgetMs: number
}): Promise<GenericAnswer | typeof UNANSWERED> {
	const { work, budgetMs } = params
	let timer: ReturnType<typeof setTimeout> | undefined
	const budget = new Promise<typeof UNANSWERED>(function waitBudget(resolve) {
		timer = setTimeout(resolve, budgetMs, UNANSWERED)
	})
	return Promise.race([work, budget]).finally(function clearBudget() {
		clearTimeout(timer)
	})
}

/** The project's key in this realm's maps and in its engine's lock (`projectKeyOf`; a connector names its project `name`). */
function keyOf(params: { name: string; dialecteId: string }): string {
	return projectKeyOf({ dialecteId: params.dialecteId, project: params.name })
}

function settleNothing(): void {}

function ignoreFailedAdoption(): void {}

/** The engine ended before it heard of the client: nothing left to tell. */
function ignoreGoneEngine(): void {}
