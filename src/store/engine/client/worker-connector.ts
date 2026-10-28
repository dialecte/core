import { ENGINE_LOCK_PREFIX } from '../engine.constants'
import { ENGINE_CLOSE_BUDGET_MS, ENGINE_OPEN_BUDGET_MS } from './client.constants'
import { createEngineClient } from './engine-client'
import { createEngineControl } from './engine-control'

import { createDialecteError } from '@/errors'
import { throwStoreClosed } from '@/store/store-errors'

import type { EngineConnector, EngineLink } from '../engine-store.types'
import type {
	EngineClient,
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
	for (const link of engine.links) {
		if (link.adoption?.generation !== engine.generation) continue
		link.adoption.client.then(function loseClient(client) {
			client.lose({ reason: 'host-gone' })
		}, ignoreFailedAdoption)
	}
	engine.worker.terminate()
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
 * opens nothing (a project of another layout is deleted too); the worker ended after.
 */
async function destroyProject(params: WorkerConnectorParams<unknown>): Promise<void> {
	const { name, engineUrl, openBudgetMs = ENGINE_OPEN_BUDGET_MS } = params
	let running = await settledEngine({ name })
	// an engine closed by its last connection meanwhile is waited for: its lock must be free first
	if (running?.ended) {
		await ENDING.get(name)
		running = undefined
	}
	const worker = running?.worker ?? new Worker(engineUrl, { type: 'module' })
	const control = running?.control ?? createEngineControl({ worker })
	await endEngine({
		name,
		engine: running,
		worker,
		ending: control.request({
			message: { type: 'destroy', project: name, lock: 'if-available', budgetMs: openBudgetMs },
			expect: 'destroyed',
		}),
	})
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
}): Promise<void> {
	const { name, engine, worker, ending } = params
	if (engine) {
		engine.ended = true
		if (ENGINES.get(name) === engine) ENGINES.delete(name)
		engine.watch?.controller.abort()
	}
	const ended = ending.then(
		function terminateWorker() {
			endWorker()
		},
		function terminateAfterFailure(thrown: unknown) {
			endWorker()
			throw thrown
		},
	)
	function endWorker(): void {
		engine?.control.end({ error: endedByRealm({ name }) })
		worker.terminate()
	}
	holdNextEngine({
		name,
		until: Promise.all([ended.then(settleNothing, settleNothing), engine?.watch?.settled]).then(
			settleNothing,
		),
	})
	return ended
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

/** `work`, or nothing once `budgetMs` has passed (the timer cleared when the work ends first). */
function withinBudget(params: { work: Promise<unknown>; budgetMs: number }): Promise<unknown> {
	const { work, budgetMs } = params
	let timer: ReturnType<typeof setTimeout> | undefined
	const budget = new Promise(function waitBudget(resolve) {
		timer = setTimeout(resolve, budgetMs)
	})
	return Promise.race([work, budget]).finally(function clearBudget() {
		clearTimeout(timer)
	})
}

function settleNothing(): void {}

function ignoreFailedAdoption(): void {}

/** The engine ended before it heard of the client: nothing left to tell. */
function ignoreGoneEngine(): void {}
