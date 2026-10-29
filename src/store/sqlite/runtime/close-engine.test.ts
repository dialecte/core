import { closeEngine } from './close-engine'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EngineRuntimeState } from './runtime.types'

/** The channels a case opened, both ends closed after it. */
const channels: MessageChannel[] = []

afterEach(() => {
	for (const channel of channels.splice(0)) {
		channel.port1.close()
		channel.port2.close()
	}
})

function drainedAtOnce(): Promise<void> {
	return Promise.resolve()
}

/** A runtime's state with an engine, one client and the lock held; what its engine and pool do when closed. */
function openState(params: { closeEngine?: () => void; pauseVfs?: () => void }): {
	state: EngineRuntimeState
	releaseLock: ReturnType<typeof vi.fn>
	port: MessagePort
} {
	const releaseLock = vi.fn()
	const channel = new MessageChannel()
	channels.push(channel)
	const port = channel.port1
	const state = {
		project: 'project-a',
		pool: { pauseVfs: params.pauseVfs ?? function pauseNothing() {} },
		releaseLock,
		engine: { close: params.closeEngine ?? function closeNothing() {} },
		events: undefined,
		heartbeat: undefined,
		clients: new Map([['client-a', { port, drained: drainedAtOnce }]]),
	} as unknown as EngineRuntimeState
	return { state, releaseLock, port }
}

describe('closing the engine', () => {
	it('an engine that closes → the lock released once, nothing left held', async () => {
		const { state, releaseLock } = openState({})
		await closeEngine({ state })
		expect(releaseLock).toHaveBeenCalledOnce()
		expect(state.releaseLock).toBeUndefined()
		expect(state.engine).toBeUndefined()
		expect(state.clients.size).toBe(0)
	})

	it('an engine whose close throws → the close refused with it, the lock released all the same', async () => {
		const { state, releaseLock } = openState({
			closeEngine: function closeFailing() {
				throw new Error('the database would not close')
			},
		})
		await expect(closeEngine({ state })).rejects.toThrow('the database would not close')
		expect(releaseLock).toHaveBeenCalledOnce()
		expect(state.releaseLock).toBeUndefined()
	})

	it('a pool whose pause throws → the close refused with it, the lock released all the same', async () => {
		const { state, releaseLock } = openState({
			pauseVfs: function pauseFailing() {
				throw new Error('a file would not let go')
			},
		})
		await expect(closeEngine({ state })).rejects.toThrow('a file would not let go')
		expect(releaseLock).toHaveBeenCalledOnce()
		expect(state.releaseLock).toBeUndefined()
	})
})
