import { refuseAnotherWire } from '../client/check-engine-wire'
import { ENGINE_CLOSE_BUDGET_MS } from '../client/client.constants'
import { createEngineControl } from '../client/engine-control'
import { ENGINE_LOCK_PREFIX } from '../engine.constants'
import { toThrownData } from '../wire/error-envelope'

import { createDialecteError, toDialecteError } from '@/errors'

import type { HostedEngine, RealmHost, RealmHostParams } from './realm-host.types'

/**
 * The engines this realm hosts for the hub: started from the dialecte's spawner when the hub asks
 * (the project's lock waited for: the engine before it may still let it go), told of their clients,
 * ended when released. What happens to each is told back to the hub: opened, failed to open, ended
 * on its own (its lock let go without the realm ending it), a client adopted or not.
 */
export function createRealmHost(params: RealmHostParams): RealmHost {
	const { report } = params
	const spawners = new Map(
		params.spawners.map(function byDialecte(spawner) {
			return [spawner.dialecteId, spawner]
		}),
	)
	const engines = new Map<string, HostedEngine>()

	function endEngine(params: { engine: HostedEngine }): void {
		const { engine } = params
		engine.ended = true
		engine.watch?.abort()
		engines.delete(engineKey(engine))
	}

	return {
		spawn: function spawnEngine({ project, dialecteId, generation, openBudgetMs }) {
			const spawner = spawners.get(dialecteId)
			let worker: Worker
			try {
				if (!spawner) {
					throw createDialecteError('PROJECT_ENGINE_UNAVAILABLE', {
						detail: `This view cannot start an engine of ${dialecteId}`,
						meta: { project, dialecteId },
					})
				}
				worker = new Worker(spawner.engineUrl, { type: 'module' })
			} catch (thrown) {
				report({
					type: 'engine-open-failed',
					project,
					generation,
					key: undefined,
					error: toThrownData({ thrown }),
				})
				return
			}
			const control = createEngineControl({ worker })
			const engine: HostedEngine = {
				project,
				generation,
				worker,
				control,
				ended: false,
				watch: undefined,
			}
			engines.set(engineKey(engine), engine)
			control
				.request({
					message: {
						type: 'open',
						project,
						lock: 'wait',
						budgetMs: openBudgetMs,
						perf: spawner.perf ?? false,
						settings: spawner.settings,
					},
					expect: 'opened',
				})
				.then(function checkWire(answer) {
					refuseAnotherWire({ found: answer.wireProtocol })
				})
				.then(
					function engineOpened() {
						// released meanwhile: the hub forgot this generation
						if (engine.ended) return
						control.opened()
						watchEngineLock({ engine, onGone: reportEnded })
						report({ type: 'engine-opened', project, generation })
					},
					function engineFailed(thrown: unknown) {
						if (engine.ended) return
						endEngine({ engine })
						control.end({ error: thrown })
						worker.terminate()
						report({
							type: 'engine-open-failed',
							project,
							generation,
							key: toDialecteError(thrown)?.key,
							error: toThrownData({ thrown }),
						})
					},
				)
		},
		adopt: function adoptClient({ project, generation, adoptionId, clientId, port }) {
			const engine = engines.get(engineKey({ project, generation }))
			if (!engine) {
				port.close()
				report({ type: 'client-adopt-failed', adoptionId })
				return
			}
			engine.control
				.request({
					message: { type: 'adopt-client', clientId, port },
					expect: 'adopted',
					transfer: [port],
				})
				.then(
					function adopted() {
						report({ type: 'client-adopted', adoptionId })
					},
					function notAdopted() {
						report({ type: 'client-adopt-failed', adoptionId })
					},
				)
		},
		clientGone: function tellClientGone({ project, generation, clientId }) {
			const engine = engines.get(engineKey({ project, generation }))
			engine?.control
				.request({ message: { type: 'client-gone', clientId }, expect: 'released' })
				.catch(ignoreGoneEngine)
		},
		release: function releaseEngine({ project, generation }) {
			const engine = engines.get(engineKey({ project, generation }))
			if (!engine) return
			endEngine({ engine })
			void closeWithinBudget({ engine }).then(function terminateWorker() {
				engine.control.end({ error: releasedError({ project }) })
				engine.worker.terminate()
			})
		},
		endAll: function endEveryEngine() {
			for (const engine of engines.values()) {
				endEngine({ engine })
				engine.control.end({ error: releasedError({ project: engine.project }) })
				engine.worker.terminate()
			}
		},
	}

	/** An engine gone without the realm ending it (a crash, out of memory): the hub is told. */
	function reportEnded(params: { engine: HostedEngine }): void {
		const { engine } = params
		if (engine.ended) return
		endEngine({ engine })
		engine.control.end({ error: releasedError({ project: engine.project }) })
		engine.worker.terminate()
		report({ type: 'engine-ended', project: engine.project, generation: engine.generation })
	}
}

/** The page asks for the engine's lock: granted once the worker holds it no more (it ended, or crashed). */
function watchEngineLock(params: {
	engine: HostedEngine
	onGone: (params: { engine: HostedEngine }) => void
}): void {
	const { engine, onGone } = params
	const controller = new AbortController()
	engine.watch = controller
	navigator.locks
		.request(
			`${ENGINE_LOCK_PREFIX}${engine.project}`,
			{ signal: controller.signal },
			function engineGone() {
				onGone({ engine })
			},
		)
		.catch(ignoreGoneEngine)
}

/** The engine told to close; settles once it has, or once the close budget has passed. */
function closeWithinBudget(params: { engine: HostedEngine }): Promise<void> {
	const { engine } = params
	let timer: ReturnType<typeof setTimeout> | undefined
	const budget = new Promise<void>(function waitBudget(resolve) {
		timer = setTimeout(resolve, ENGINE_CLOSE_BUDGET_MS)
	})
	const closed = engine.control
		.request({ message: { type: 'close' }, expect: 'closed' })
		.then(ignoreGoneEngine, ignoreGoneEngine)
	return Promise.race([closed, budget]).finally(function clearBudget() {
		clearTimeout(timer)
	})
}

/** What a request to an engine the realm ended answers. */
function releasedError(params: { project: string }): Error {
	return createDialecteError('STORE_CLOSED', {
		detail: `The engine of project "${params.project}" was released`,
		meta: { storeName: params.project },
	})
}

function engineKey(params: { project: string; generation: number }): string {
	return `${params.project}#${params.generation}`
}

/** The engine ended before it answered: nothing left to tell. */
function ignoreGoneEngine(): void {}
