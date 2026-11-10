import { CLIENT_DRAIN_BUDGET_MS } from '../served/host/host.constants'

import { yieldToQueue } from '@/utils/yield-to-queue'

import type { ServedClient } from '../served/host/host.types'
import type { EngineRuntimeState } from './runtime.types'

/** Every import and export aborted, the database closed, the pool paused (its files kept), the lock released. */
export async function closeEngine(params: { state: EngineRuntimeState }): Promise<void> {
	const { state } = params
	try {
		await endEngineAndClients({ state })
	} finally {
		// the lock let go whatever ending the engine did: in hub mode the next engine waits for it
		await releasePool({ state })
	}
}

/**
 * The engine closed (every import and export aborted), then each client port closed once the calls it
 * was asked have answered (an aborted import answers `IMPORT_ABORTED`), within `CLIENT_DRAIN_BUDGET_MS`.
 * The engine and its clients are let go whatever its close does: the worker may open the project again.
 */
export async function endEngineAndClients(params: { state: EngineRuntimeState }): Promise<void> {
	const { state } = params
	const { engine } = state
	state.engine = undefined
	const clients = [...state.clients.values()]
	state.clients.clear()
	try {
		engine?.close()
	} finally {
		await closeClients({ state, clients })
	}
}

/** Each client port closed once its calls have answered, within `CLIENT_DRAIN_BUDGET_MS`; the channel closed. */
async function closeClients(params: {
	state: EngineRuntimeState
	clients: ServedClient[]
}): Promise<void> {
	const { state, clients } = params
	let budget: ReturnType<typeof setTimeout> | undefined
	await Promise.race([
		Promise.all(
			clients.map(function drainedOf(client) {
				return client.drained()
			}),
		),
		new Promise(function waitDrainBudget(resolve) {
			budget = setTimeout(resolve, CLIENT_DRAIN_BUDGET_MS)
		}),
	])
	clearTimeout(budget)
	// the answers posted first: a port closed a turn later never loses one
	await yieldToQueue()
	for (const client of clients) client.port.close()
	state.events?.close()
	state.events = undefined
	state.heartbeat = undefined
}

/**
 * The pool paused and the lock released whatever the pause does: the files stay, another engine may open them.
 * Settled once the browser has let the lock go: an answer posted after it finds the lock free in any context.
 */
export async function releasePool(params: { state: EngineRuntimeState }): Promise<void> {
	const { state } = params
	state.events?.close()
	state.events = undefined
	state.heartbeat = undefined
	try {
		state.pool?.pauseVfs()
	} finally {
		const release = state.releaseLock
		state.releaseLock = undefined
		await release?.()
	}
}
