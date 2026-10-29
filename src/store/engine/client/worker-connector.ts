import { ENGINE_LOCK_PREFIX } from '../engine.constants'
import {
	DESTROYED,
	ENGINE_CLOSE_BUDGET_MS,
	ENGINE_OPEN_BUDGET_MS,
	UNANSWERED,
} from './client.constants'
import { createEngineClient } from './engine-client'
import { createEngineControl } from './engine-control'

import { createDialecteError } from '@/errors'
import { throwStoreClosed } from '@/store/store-errors'

import type { EngineConnector, EngineLink } from '../engine-store.types'
import type { EngineLockMode } from '../engine.types'
import type {
	EngineClient,
	EngineControl,
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
		destroy: function destroyThroughEngine() {
			return destroyProject(params)
		},
	}
}

async function linkToEngine(params: WorkerConnectorParams<unknown>): Promise<EngineLink> {
	const state: WorkerLinkState = {
		clientId: crypto.randomUUID(),
		released: false,
		adoption: undefined,
	}
	const running = await runningEngine(params)
	running.links.add(state)
	return {
		engine: async function currentEngine() {
			if (state.released) throwStoreClosed({ storeName: params.name })
			const engine = await runningEngine(params)
			engine.links.add(state)
			if (state.adoption?.generation !== engine.generation) {
				// the client of an engine gone since is let go: its port, its watch, its page listeners
				releaseSupersededClient({ adoption: state.adoption, storeName: params.name })
				state.adoption = {
					generation: engine.generation,
					client: adoptClient({
						engine,
						state,
						heartbeatTimeoutMs: params.liveness?.heartbeatTimeoutMs,
					}),
				}
			}
			const client = await state.adoption.client
			return client.api
		},
		close: function releaseLink() {
			if (state.released) return
			state.released = true
			const engine = ENGINES.get(params.name)
			releaseClient({ engine, state, storeName: params.name })
			if (!engine?.links.delete(state) || engine.links.size > 0) return
			closeEngine({ name: params.name, engine })
		},
	}
}

/** The realm's engine of the name, started first when none runs (once any of the name has ended). */
async function runningEngine(params: WorkerConnectorParams<unknown>): Promise<RealmEngine> {
	const { name } = params
	await ENDING.get(name)
	let engine = ENGINES.get(name)
	if (!engine) {
		engine = spawnEngine(params)
		ENGINES.set(name, engine)
	}
	try {
		await engine.opened
	} catch (thrown) {
		if (ENGINES.get(name) === engine) ENGINES.delete(name)
		throw thrown
	}
	return engine
}

/** A worker for the project; opened, it is watched through the engine lock. */
function spawnEngine(params: WorkerConnectorParams<unknown>): RealmEngine {
	const {
		name,
		engineUrl,
		perf = false,
		openBudgetMs = ENGINE_OPEN_BUDGET_MS,
		liveness = {},
		settings,
	} = params
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
	engine.opened = control
		.request({
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
		.then(
			function engineOpened() {
				control.opened()
				// ended meanwhile by the realm (a destroy): nothing to watch
				if (!engine.ended) watchEngineLock({ name, engine })
			},
			function endFailedEngine(thrown: unknown) {
				engine.ended = true
				control.end({ error: thrown })
				worker.terminate()
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
	const lost = createDialecteError('STORE_ENGINE_LOST', {
		detail: 'The project engine ended with the view that hosted it',
		meta: { reason: 'host-gone' },
	})
	engine.control.end({ error: lost })
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

/** A client of its own for the connection: a new port, handed to the engine. */
async function adoptClient(params: {
	engine: RealmEngine
	state: WorkerLinkState
	heartbeatTimeoutMs: number | undefined
}): Promise<EngineClient> {
	const { engine, state, heartbeatTimeoutMs } = params
	const channel = new MessageChannel()
	await engine.control.request({
		message: { type: 'adopt-client', clientId: state.clientId, port: channel.port2 },
		expect: 'adopted',
		transfer: [channel.port2],
	})
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
 * The project deleted: through its engine when one runs in this realm, else through a worker that
 * opens nothing (a project of another layout is deleted too); the worker ended after. A running engine
 * that does not answer within the close budget is ended and a fresh worker deletes the project - one
 * not cut short: it waits for the lock within its own budget and answers what it found.
 */
async function destroyProject(params: WorkerConnectorParams<unknown>): Promise<void> {
	const { name, engineUrl, openBudgetMs = ENGINE_OPEN_BUDGET_MS } = params
	let running = await settledEngine({ name })
	// an engine closed by its last connection meanwhile is waited for: its lock must be free first
	if (running?.ended) {
		await ENDING.get(name)
		running = undefined
	}
	if (running) {
		const answered = await endEngine({
			name,
			engine: running,
			worker: running.worker,
			ending: withinBudget({
				work: askDestroy({
					name,
					control: running.control,
					lock: 'if-available',
					budgetMs: openBudgetMs,
				}),
				budgetMs: ENGINE_CLOSE_BUDGET_MS,
			}),
		})
		if (answered === DESTROYED) return
		// deaf: its worker ended; the fresh worker waits for the lock it lets go (late on a loaded machine)
		await ENDING.get(name)
		await destroyFromFreshWorker({ name, engineUrl, lock: 'wait', budgetMs: openBudgetMs })
		return
	}
	await destroyFromFreshWorker({ name, engineUrl, lock: 'if-available', budgetMs: openBudgetMs })
}

/** A worker that opens nothing deletes the project, waiting for the lock or not; ended after. */
async function destroyFromFreshWorker(params: {
	name: string
	engineUrl: string
	lock: EngineLockMode
	budgetMs: number
}): Promise<void> {
	const { name, engineUrl, lock, budgetMs } = params
	const worker = new Worker(engineUrl, { type: 'module' })
	await endEngine({
		name,
		engine: undefined,
		worker,
		ending: askDestroy({ name, control: createEngineControl({ worker }), lock, budgetMs }),
	})
}

/** The engine asked to delete the project; `DESTROYED` once it has (`withinBudget` answers `UNANSWERED` for one that does not). */
async function askDestroy(params: {
	name: string
	control: EngineControl
	lock: EngineLockMode
	budgetMs: number
}): Promise<typeof DESTROYED> {
	const { name, control, lock, budgetMs } = params
	await control.request({
		message: { type: 'destroy', project: name, lock, budgetMs },
		expect: 'destroyed',
	})
	return DESTROYED
}

/**
 * The realm's engine of the name once its open has settled - none, or none that opened - after any
 * engine of the name still ending.
 */
async function settledEngine(params: { name: string }): Promise<RealmEngine | undefined> {
	const { name } = params
	await ENDING.get(name)
	const running = ENGINES.get(name)
	if (!running) return undefined
	await running.opened.catch(settleNothing)
	return running.ended ? undefined : running
}

/** The engine told to close, then its worker ended once it has closed or the close budget has passed. */
function closeEngine(params: { name: string; engine: RealmEngine }): void {
	const { name, engine } = params
	void endEngine({
		name,
		engine,
		worker: engine.worker,
		ending: withinBudget({
			work: engine.control.request({ message: { type: 'close' }, expect: 'closed' }),
			budgetMs: ENGINE_CLOSE_BUDGET_MS,
		}),
	}).catch(ignoreGoneEngine)
}

/**
 * An engine the realm ends itself: its lock watch withdrawn first (its own release is no death), the
 * work asked of it awaited, then its worker ended; the next engine of the name starts once all of it
 * has settled.
 */
function endEngine(params: {
	name: string
	engine: RealmEngine | undefined
	worker: Worker
	ending: Promise<unknown>
}): Promise<unknown> {
	const { name, engine, worker, ending } = params
	if (engine) {
		engine.ended = true
		if (ENGINES.get(name) === engine) ENGINES.delete(name)
		engine.watch?.controller.abort()
	}
	let answered = true
	const ended = ending.then(
		function terminateWorker(answer: unknown) {
			endWorker({ answered: answer !== UNANSWERED })
			return answer
		},
		function terminateAfterFailure(thrown: unknown) {
			endWorker({ answered: true })
			throw thrown
		},
	)
	function endWorker(params: { answered: boolean }): void {
		answered = params.answered
		engine?.control.end({ error: endedByRealm({ name }) })
		worker.terminate()
		// a call still in flight on a deaf engine is refused at once; one that answered drained its calls first
		if (engine && !answered) loseClientsOf({ engine })
	}
	// the next engine waits for the ended worker to let the lock go: one ended deaf may hold it for seconds on a loaded machine
	const lockFree = ended.then(settleNothing, settleNothing).then(function waitForLock() {
		return untilLockFree({
			name,
			budgetMs: answered ? ENGINE_CLOSE_BUDGET_MS : ENGINE_OPEN_BUDGET_MS,
		})
	})
	holdNextEngine({
		name,
		until: Promise.all([lockFree, engine?.watch?.settled]).then(settleNothing),
	})
	return ended
}

/**
 * The page granted the engine's lock (let go at once): its last holder in this realm let it go - or
 * the budget passed (another realm's engine may hold it: the next open answers that).
 */
function untilLockFree(params: { name: string; budgetMs: number }): Promise<void> {
	return navigator.locks
		.request(
			`${ENGINE_LOCK_PREFIX}${params.name}`,
			{ signal: AbortSignal.timeout(params.budgetMs) },
			settleNothing,
		)
		.then(settleNothing, settleNothing)
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

/** What a request to an engine the realm ended answers: the store is closed. */
function endedByRealm(params: { name: string }): Error {
	return createDialecteError('STORE_CLOSED', {
		detail: `The engine of project "${params.name}" was ended`,
		meta: { storeName: params.name },
	})
}

/** `work`, or `UNANSWERED` once `budgetMs` has passed (the timer cleared when the work ends first). */
function withinBudget(params: { work: Promise<unknown>; budgetMs: number }): Promise<unknown> {
	const { work, budgetMs } = params
	let timer: ReturnType<typeof setTimeout> | undefined
	const budget = new Promise(function waitBudget(resolve) {
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
