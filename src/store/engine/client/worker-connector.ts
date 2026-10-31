import { createOpenConnections } from '../../open-connections'
import { throwOpenElsewhere } from '../../store-errors'
import { ENGINE_LOCK_PREFIX } from '../engine.constants'
import { refuseAnotherWire } from './check-engine-wire'
import {
	ENGINE_CLOSE_BUDGET_MS,
	ENGINE_HEARTBEAT_TIMEOUT_MS,
	ENGINE_OPEN_BUDGET_MS,
	ENGINE_OPEN_WINDOW_MS,
	ENGINE_LOST_DETAILS,
	UNANSWERED,
} from './client.constants'
import { createEngineClient } from './engine-client'
import { answeredOrSilent, createEngineControl } from './engine-control'

import { createDialecteError } from '@/errors'
import { throwStoreClosed } from '@/store/store-errors'

import type { EngineConnector, EngineLink, OwnEngineLink } from '../engine-store.types'
import type { EngineLockMode } from '../engine.types'
import type {
	EngineClient,
	EngineControl,
	EngineEnding,
	FreshWorkerDestroy,
	RealmEngine,
	WorkerConnectorParams,
	WorkerLinkState,
} from './client.types'

/** The engine worker this realm runs for each project name (direct mode: one per name). */
const ENGINES = new Map<string, RealmEngine>()
/** The engines of a name still closing or being destroyed: the next one of the name waits for them. */
const ENDING = new Map<string, Promise<void>>()
/** Numbers every engine the realm starts: a connection adopted by an engine since gone adopts again. */
const generations = { next: 0 }
/** The connections of this realm to each name, from their connect until closed: a destroy is refused while one is. */
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
		adoption: undefined,
	}
	OPEN_LINKS.markOpen({ name: params.name, connection: state })
	await runningEngine({ connector: params, link: state }).catch(function forgetFailedLink(
		thrown: unknown,
	) {
		OPEN_LINKS.markClosed({ name: params.name, connection: state })
		throw thrown
	})
	const link: EngineLink = {
		engine: async function currentEngine() {
			if (state.released) throwStoreClosed({ storeName: params.name })
			const engine = await runningEngine({ connector: params, link: state })
			if (state.adoption?.generation !== engine.generation) {
				// the client of an engine gone since is let go: its port, its watch, its page listeners
				releaseSupersededClient({ adoption: state.adoption, storeName: params.name })
				state.adoption = {
					generation: engine.generation,
					client: adoptClient({
						name: params.name,
						engine,
						state,
						heartbeatTimeoutMs: params.liveness?.heartbeatTimeoutMs,
						openBudgetMs,
					}),
				}
			}
			const client = await state.adoption.client
			return client.api
		},
		close: function releaseLink() {
			if (state.released) return
			state.released = true
			OPEN_LINKS.markClosed({ name: params.name, connection: state })
			const engine = ENGINES.get(params.name)
			releaseClient({ engine, state, storeName: params.name })
			if (!engine?.links.delete(state) || engine.links.size > 0) return
			closeEngine({ name: params.name, engine, openBudgetMs })
		},
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
	await ENDING.get(name)
	if (link.released) throwStoreClosed({ storeName: name })
	let engine = ENGINES.get(name)
	if (!engine) {
		engine = spawnEngine(connector)
		ENGINES.set(name, engine)
	}
	engine.links.add(link)
	try {
		await engine.opened
	} catch (thrown) {
		engine.links.delete(link)
		if (ENGINES.get(name) === engine) ENGINES.delete(name)
		throw thrown
	}
	if (link.released) throwStoreClosed({ storeName: name })
	return engine
}

/**
 * A worker for the project; opened, it is watched through the engine lock. One silent past the open window
 * is ended, the open refused `PROJECT_ENGINE_UNAVAILABLE`.
 */
function spawnEngine(params: WorkerConnectorParams<unknown>): RealmEngine {
	const {
		name,
		engineUrl,
		perf = false,
		openBudgetMs = ENGINE_OPEN_BUDGET_MS,
		liveness = {},
		settings,
	} = params
	// never shorter than the engine's own budget and the time to answer
	const openWindowMs = Math.max(
		params.openWindowMs ?? ENGINE_OPEN_WINDOW_MS,
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
	}
	const opening = control.request({
		message: {
			type: 'open',
			project: name,
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
			refuseAnotherWire({ found: answer.wireProtocol })
		})
		.then(
			function engineOpened() {
				control.opened()
				// ended meanwhile by the realm (its last connection closed while it opened): nothing to watch
				if (!engine.ended) watchEngineLock({ name, engine })
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
function watchEngineLock(params: { name: string; engine: RealmEngine }): void {
	const { name, engine } = params
	const controller = new AbortController()
	const settled = navigator.locks
		.request(`${ENGINE_LOCK_PREFIX}${name}`, { signal: controller.signal }, function engineGone() {
			endLostEngine({ name, engine })
		})
		.then(settleNothing, settleNothing)
	engine.watch = { controller, settled }
}

/**
 * The engine gone on its own: every call in flight on it refused `STORE_ENGINE_LOST` (`host-gone`),
 * its worker ended; the next call of a connection starts another engine.
 */
function endLostEngine(params: { name: string; engine: RealmEngine }): void {
	const { name, engine } = params
	if (engine.ended) return
	engine.ended = true
	if (ENGINES.get(name) === engine) ENGINES.delete(name)
	engine.control.end({ error: lostEngine() })
	// the next engine of the name starts once the page has let the lock go
	if (engine.watch) holdNextEngine({ name, until: engine.watch.settled })
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
		}, ignoreFailedAdoption)
	}
}

/**
 * A client of its own for the connection: a new port, handed to the engine. An engine silent for the
 * heartbeat timeout while not busy is lost: ended (the calls in flight of its other clients, and their
 * adoptions, refused `STORE_ENGINE_LOST` `host-gone`, the next call starting another engine) and the
 * adoption refused `PROJECT_ENGINE_UNAVAILABLE`. A busy one - dialecte code running long - is waited for.
 */
async function adoptClient(params: {
	name: string
	engine: RealmEngine
	state: WorkerLinkState
	heartbeatTimeoutMs: number | undefined
	openBudgetMs: number
}): Promise<EngineClient> {
	const {
		name,
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
	const { name, engineUrl, openBudgetMs = ENGINE_OPEN_BUDGET_MS } = connector
	refuseWhileOpen({ name, own: own === undefined ? undefined : LINK_STATES.get(own.link) })
	// its engine closed with it when it was the last connection: waited for below, as any still ending
	own?.letGo()
	const ending = ENDING.get(name)
	let destroyEnded: () => void = settleNothing
	holdNextEngine({
		name,
		until: new Promise<void>(function untilDestroyEnded(resolve) {
			destroyEnded = resolve
		}),
	})
	// what waits for this destroy - another destroy of the name too - waits for its fresh worker as the next
	// engine does: until it let the lock go, within the budget its answer gave it
	let released: Promise<void> = Promise.resolve()
	try {
		await ending
		assertNoEngine({ name })
		const destroying = startFreshWorkerDestroy({
			name,
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

/** Refused `PROJECT_OPEN_ELSEWHERE` while a connection of this realm but `own` has the project open. */
function refuseWhileOpen(params: { name: string; own?: WorkerLinkState }): void {
	const open = OPEN_LINKS.others({ name: params.name, connection: params.own })
	if (open > 0) throwOpenElsewhere({ storeName: params.name, connections: open })
}

/**
 * No other connection open when the destroy went ahead, and none of its engines ending: the realm runs no
 * engine of the name - each one starts for a connection (one made since waits for the destroy), a closed
 * one starts none, and each is closed with its last connection, one still opening too.
 */
function assertNoEngine(params: { name: string }): void {
	if (!ENGINES.has(params.name)) return
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
	engineUrl: string
	budgetMs: number
	lock: EngineLockMode
}): Promise<void> {
	await startFreshWorkerDestroy(params).done
}

/** The fresh worker's destroy started: its answer, and when the next engine of the name may start after it. */
function startFreshWorkerDestroy(params: {
	name: string
	engineUrl: string
	budgetMs: number
	lock: EngineLockMode
}): FreshWorkerDestroy {
	const { name, engineUrl, budgetMs, lock } = params
	const worker = new Worker(engineUrl, { type: 'module' })
	const { ended, released } = endEngine({
		name,
		engine: undefined,
		worker,
		lockBudgetMs: budgetMs,
		ending: withinBudget({
			work: askDestroy({ name, control: createEngineControl({ worker }), budgetMs, lock }),
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
	control: EngineControl
	budgetMs: number
	lock: EngineLockMode
}): Promise<void> {
	const { name, control, budgetMs, lock } = params
	await control.request({
		message: { type: 'destroy', project: name, lock, budgetMs },
		expect: 'destroyed',
	})
}

/**
 * The engine told to close, then its worker ended once it has closed or the close budget has passed -
 * counted from now, an engine still opening included (only a raw connection closes one mid-open: a
 * store releases its connection once its open has settled); ended unopened, its lock is waited for.
 */
function closeEngine(params: { name: string; engine: RealmEngine; openBudgetMs: number }): void {
	const { name, engine, openBudgetMs } = params
	void endEngine({
		name,
		engine,
		worker: engine.worker,
		lockBudgetMs: openBudgetMs,
		ending: withinBudget({
			work: engine.control.request({ message: { type: 'close' }, expect: 'closed' }),
			budgetMs: ENGINE_CLOSE_BUDGET_MS,
		}),
	}).ended.catch(ignoreGoneEngine)
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
	engine: RealmEngine | undefined
	worker: Worker
	ending: Promise<unknown>
	lockBudgetMs: number
}): EngineEnding {
	const { name, engine, worker, ending, lockBudgetMs } = params
	if (engine) {
		engine.ended = true
		if (ENGINES.get(name) === engine) ENGINES.delete(name)
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
		return untilLockFree({ name, budgetMs: deaf ? lockBudgetMs : ENGINE_CLOSE_BUDGET_MS })
	})
	const released = Promise.all([lockFree, engine?.watch?.settled]).then(settleNothing)
	holdNextEngine({ name, until: released })
	return { ended, released }
}

/**
 * The page granted the engine's lock (let go at once): its last holder in this realm let it go - true;
 * or the budget passed - false (another realm's engine may hold it: the next open answers that).
 */
function untilLockFree(params: { name: string; budgetMs: number }): Promise<boolean> {
	return navigator.locks
		.request(
			`${ENGINE_LOCK_PREFIX}${params.name}`,
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

/** The next engine of the name waits until `until` has settled (and whatever it waited for before). */
function holdNextEngine(params: { name: string; until: Promise<void> }): void {
	const { name, until } = params
	const settled = Promise.all([ENDING.get(name), until]).then(settleNothing)
	ENDING.set(name, settled)
	void settled.then(function forgetEnding() {
		if (ENDING.get(name) === settled) ENDING.delete(name)
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

function settleNothing(): void {}

function ignoreFailedAdoption(): void {}

/** The engine ended before it heard of the client: nothing left to tell. */
function ignoreGoneEngine(): void {}
