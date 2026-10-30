import { ENGINE_LOCK_PREFIX } from '../engine.constants'
import { refuseAnotherWire } from './check-engine-wire'
import { ENGINE_CLOSE_BUDGET_MS, ENGINE_OPEN_BUDGET_MS, UNANSWERED } from './client.constants'
import { createEngineClient } from './engine-client'
import { createEngineControl } from './engine-control'

import { createDialecteError } from '@/errors'
import { throwStoreClosed } from '@/store/store-errors'

import type { EngineConnector, EngineLink } from '../engine-store.types'
import type { EngineLockMode } from '../engine.types'
import type {
	EngineClient,
	EngineControl,
	LockLetGoWatch,
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
			closeEngine({
				name: params.name,
				engine,
				openBudgetMs: params.openBudgetMs ?? ENGINE_OPEN_BUDGET_MS,
			})
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
		.then(function checkWire(answer) {
			refuseAnotherWire({ found: answer.wireProtocol })
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
 * has its open budget to delete it (a file still held is waited for) and the close budget to answer;
 * one that does not is ended, and once it has let the lock go a fresh worker deletes the project - the
 * next engine of the name waits for that too.
 */
async function destroyProject(params: WorkerConnectorParams<unknown>): Promise<void> {
	const { name, engineUrl, openBudgetMs = ENGINE_OPEN_BUDGET_MS } = params
	let running = await settledEngine({ name })
	// an engine closed by its last connection meanwhile is waited for: its lock must be free first
	if (running?.ended) {
		await ENDING.get(name)
		running = undefined
	}
	if (!running) {
		await destroyFromFreshWorker({ name, engineUrl, budgetMs: openBudgetMs, lock: 'if-available' })
		return
	}
	// its lock watch ends with it: an engine that crashes during the destroy is seen once it lets the lock go
	const letGo = watchLockLetGo({ name })
	await endEngine({
		name,
		engine: running,
		worker: running.worker,
		lockBudgetMs: openBudgetMs,
		ending: withinBudget({
			work: askDestroy({
				name,
				control: running.control,
				budgetMs: openBudgetMs,
				lock: 'if-available',
			}),
			budgetMs: openBudgetMs + ENGINE_CLOSE_BUDGET_MS,
			cutShort: letGo.granted,
		}).finally(letGo.stop),
		// a grant let go a moment after the destroy settled: this realm's next engine waits for it
		watchSettled: letGo.settled,
		ifDeaf: function destroyThroughFreshWorker() {
			return destroyFromFreshWorker({
				name,
				engineUrl,
				budgetMs: openBudgetMs,
				lock: 'if-available',
			})
		},
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
	const { name, engineUrl, budgetMs, lock } = params
	const worker = new Worker(engineUrl, { type: 'module' })
	const answer = await endEngine({
		name,
		engine: undefined,
		worker,
		lockBudgetMs: budgetMs,
		ending: withinBudget({
			work: askDestroy({ name, control: createEngineControl({ worker }), budgetMs, lock }),
			budgetMs: budgetMs + ENGINE_CLOSE_BUDGET_MS,
		}),
	})
	if (answer === UNANSWERED) {
		throw createDialecteError('PROJECT_DESTROY_FAILED', {
			detail: `Project "${name}" was not destroyed: its engine worker gave no answer within ${budgetMs + ENGINE_CLOSE_BUDGET_MS} ms`,
			meta: { project: name, budgetMs },
		})
	}
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
	}).catch(ignoreGoneEngine)
}

/**
 * An engine the realm ends itself: its lock watch withdrawn first (its own release is no death), the
 * work asked of it awaited, then its worker ended. One that gave no answer may hold the lock a while
 * after (seconds on a loaded machine): it is waited for within `lockBudgetMs`, then `ifDeaf` runs. The
 * next engine of the name starts once all of it has settled - registered before any call on the ended
 * engine is refused, so a caller retrying at once waits for it too. Answers the work's answer, or once
 * deaf what `ifDeaf` answers.
 */
function endEngine(params: {
	name: string
	engine: RealmEngine | undefined
	worker: Worker
	ending: Promise<unknown>
	lockBudgetMs: number
	ifDeaf?: () => Promise<void>
	/** Another page request of the lock, made for this ending: the next engine waits for it too. */
	watchSettled?: Promise<void>
}): Promise<unknown> {
	const { name, engine, worker, ending, lockBudgetMs, ifDeaf, watchSettled } = params
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
		// a call still in flight on a deaf engine is refused at once; one that answered drained its calls first
		if (engine && deaf) loseClientsOf({ engine })
	}
	const lockFree = ended.then(settleNothing, settleNothing).then(function waitForLock() {
		return untilLockFree({ name, budgetMs: deaf ? lockBudgetMs : ENGINE_CLOSE_BUDGET_MS })
	})
	const followedUp = lockFree.then(function followUpIfDeaf(free: boolean) {
		if (!deaf || !ifDeaf) return undefined
		// still held by the ended worker: a fresh one could not take it either
		if (!free) {
			throw createDialecteError('PROJECT_ENGINE_BUSY', {
				detail: `Project "${name}" was still held by an engine ended for giving no answer after ${lockBudgetMs} ms`,
				meta: { project: name, budgetMs: lockBudgetMs },
			})
		}
		return ifDeaf()
	})
	holdNextEngine({
		name,
		until: Promise.all([
			followedUp.then(settleNothing, settleNothing),
			engine?.watch?.settled,
			watchSettled,
		]).then(settleNothing),
	})
	return ended.then(function answerOrFollowUp(answer: unknown) {
		return deaf && ifDeaf ? followedUp : answer
	})
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

/** What a request to an engine the realm ended answers: the store is closed. */
function endedByRealm(params: { name: string }): Error {
	return createDialecteError('STORE_CLOSED', {
		detail: `The engine of project "${params.name}" was ended`,
		meta: { storeName: params.name },
	})
}

/**
 * `work`, or `UNANSWERED` once `budgetMs` has passed - or, once `cutShort` has settled, once
 * `ENGINE_CLOSE_BUDGET_MS` more has passed, whichever comes first (the timers cleared when the work
 * ends first).
 */
function withinBudget(params: {
	work: Promise<unknown>
	budgetMs: number
	cutShort?: Promise<void>
}): Promise<unknown> {
	const { work, budgetMs, cutShort } = params
	const timers: ReturnType<typeof setTimeout>[] = []
	let settled = false
	const budget = new Promise(function waitBudget(resolve) {
		timers.push(setTimeout(resolve, budgetMs, UNANSWERED))
		void cutShort?.then(function waitCloseBudget() {
			// cut short once the race is over: no timer left behind
			if (!settled) timers.push(setTimeout(resolve, ENGINE_CLOSE_BUDGET_MS, UNANSWERED))
		})
	})
	return Promise.race([work, budget]).finally(function clearBudget() {
		settled = true
		for (const timer of timers) clearTimeout(timer)
	})
}

/**
 * The engine lock of the name asked for from this page while its engine holds it: `granted` settles
 * once the engine's worker has let it go (it answered, or it ended), the lock let go at once; `stop`
 * withdraws a request not granted yet.
 */
function watchLockLetGo(params: { name: string }): LockLetGoWatch {
	const controller = new AbortController()
	let markGranted: () => void = settleNothing
	const granted = new Promise<void>(function waitForGrant(resolve) {
		markGranted = resolve
	})
	const settled = navigator.locks
		.request(`${ENGINE_LOCK_PREFIX}${params.name}`, { signal: controller.signal }, markGranted)
		.then(settleNothing, settleNothing)
	return {
		granted,
		settled,
		stop: function stopWatching() {
			controller.abort()
		},
	}
}

function settleNothing(): void {}

function ignoreFailedAdoption(): void {}

/** The engine ended before it heard of the client: nothing left to tell. */
function ignoreGoneEngine(): void {}
