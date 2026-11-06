import { SQLITE_ERRORS } from '../../sqlite-errors.constants'
import { refuseAnotherWire } from '../client/check-engine-wire'
import { ENGINE_CLOSE_BUDGET_MS, ENGINE_HEARTBEAT_TIMEOUT_MS } from '../client/client.constants'
import { answeredOrSilent, createEngineControl } from '../client/engine-control'
import { refuseAnotherDialecte } from '../dialecte-refusal'
import { engineLockNameOf } from '../engine-lock'
import { toThrownData } from '../wire/error-envelope'

import { createDialecteError, toDialecteError } from '@/errors'

import type { EngineControl } from '../client/client.types'
import type { HostedEngine, RealmHost, RealmHostParams } from './realm-host.types'

/**
 * The engines this realm hosts for the hub: started from the dialecte's spawner when the hub asks
 * (the project's lock waited for: the engine before it may still let it go), told of their clients,
 * ended when released. What happens to each is told back to the hub: opened, failed to open, ended
 * on its own (its lock let go without the realm ending it), a client adopted or not - an engine silent
 * past the adopt budget did not adopt it (the hub then takes that engine for ended).
 */
export function createRealmHost(params: RealmHostParams): RealmHost {
	const { report, adoptBudgetMs = ENGINE_HEARTBEAT_TIMEOUT_MS } = params
	// the host's own copies: a spawner added later may turn measuring on for its dialecte's next engines
	const spawners = new Map(
		params.spawners.map(function byDialecte(spawner) {
			return [spawner.dialecteId, { ...spawner }]
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
		spawn: function spawnEngine({
			project,
			dialecteId,
			generation,
			openBudgetMs,
			expectedCreationId,
		}) {
			const spawner = spawners.get(dialecteId)
			let worker: Worker
			try {
				if (!spawner) {
					throw createDialecteError(SQLITE_ERRORS.PROJECT_ENGINE_UNAVAILABLE, {
						detail: `This view cannot start an engine of ${dialecteId}`,
						meta: { project, dialecteId },
					})
				}
				worker = new Worker(spawner.engineUrl, { type: 'module' })
			} catch (thrown) {
				report({
					type: 'engine-open-failed',
					project,
					dialecteId,
					generation,
					key: undefined,
					error: toThrownData({ thrown }),
				})
				return
			}
			const control = createEngineControl({ worker })
			const engine: HostedEngine = {
				project,
				dialecteId,
				generation,
				worker,
				control,
				ended: false,
				watch: undefined,
			}
			engines.set(engineKey(engine), engine)
			// measured as the spawner is now; what the engine opens with is loaded meanwhile (the worker loads its script)
			const perf = spawner.perf ?? false
			Promise.resolve()
				.then(spawner.settings)
				.then(function askOpen(settings) {
					return control.request({
						message: {
							type: 'open',
							project,
							dialecteId,
							dialecteVersion: spawner.dialecteVersion,
							...(expectedCreationId !== undefined && { expectedCreationId }),
							lock: 'wait',
							budgetMs: openBudgetMs,
							perf,
							settings,
						},
						expect: 'opened',
					})
				})
				.then(function checkWire(answer) {
					refuseAnotherWire({ found: answer.wireProtocol })
					// an engine of another copy of the library may not check what it was asked: its answer is
					refuseAnotherDialecte({
						project,
						engine: answer,
						asked: { dialecteId, dialecteVersion: spawner.dialecteVersion },
					})
					return answer.creationId
				})
				.then(
					function engineOpened(creationId: string) {
						// released meanwhile: the hub forgot this generation
						if (engine.ended) return
						control.opened()
						watchEngineLock({ engine, onGone: reportEnded })
						report({
							type: 'engine-opened',
							project,
							dialecteId,
							generation,
							creationId,
						})
					},
					function engineFailed(thrown: unknown) {
						if (engine.ended) return
						endEngine({ engine })
						control.end({ error: thrown })
						worker.terminate()
						report({
							type: 'engine-open-failed',
							project,
							dialecteId,
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
			const adopting = engine.control.request({
				message: { type: 'adopt-client', clientId, port },
				expect: 'adopted',
				transfer: [port],
			})
			reportAdoption({
				control: engine.control,
				adopting,
				adoptionId,
				budgetMs: adoptBudgetMs,
				report,
			})
		},
		clientGone: async function tellClientGone({ project, generation, clientId }) {
			const engine = engines.get(engineKey({ project, generation }))
			await engine?.control
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
		add: function addSpawners({ spawners: added }) {
			for (const spawner of added) {
				const running = spawners.get(spawner.dialecteId)
				if (!running) spawners.set(spawner.dialecteId, { ...spawner })
				// the dialecte keeps its first spawner; one measured turns measuring on for the engines started next
				else if (spawner.perf) running.perf = true
			}
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
		report({
			type: 'engine-ended',
			project: engine.project,
			dialecteId: engine.dialecteId,
			generation: engine.generation,
		})
	}
}

/**
 * The engine's answer to an adoption told the hub once: adopted, or not - refused, or silent past the budget
 * while not busy (a late answer then changes nothing; a busy engine is waited for).
 */
function reportAdoption(params: {
	control: EngineControl
	adopting: Promise<unknown>
	adoptionId: number
	budgetMs: number
	report: RealmHostParams['report']
}): void {
	const { control, adopting, adoptionId, budgetMs, report } = params
	const answered = adopting.then(adoptionAnswered, adoptionRefused)
	void answeredOrSilent({ control, work: answered, budgetMs }).then(function tellHub(adopted) {
		report({ type: adopted === true ? 'client-adopted' : 'client-adopt-failed', adoptionId })
	})
}

function adoptionAnswered(): boolean {
	return true
}

function adoptionRefused(): boolean {
	return false
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
			engineLockNameOf({ dialecteId: engine.dialecteId, project: engine.project }),
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

/** An engine of the hub's: its generation is the hub's own counter, never used twice, whatever the project. */
function engineKey(params: { project: string; generation: number }): string {
	return `${params.project}#${params.generation}`
}

/** The engine ended before it answered: nothing left to tell. */
function ignoreGoneEngine(): void {}
