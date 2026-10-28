import { createHeartbeat } from './heartbeat'

import { afterEach, describe, expect, it } from 'vitest'

/** What a case leaves: its ports closed. */
const cleanups: (() => void)[] = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

/** A port the heartbeat may post on, and the signals its other end heard (after a message turn). */
function listenedPort(): { port: MessagePort; heard: () => Promise<string[]> } {
	const channel = new MessageChannel()
	const signals: string[] = []
	channel.port2.onmessage = function hear(event: MessageEvent<{ type: string }>) {
		signals.push(event.data.type)
	}
	cleanups.push(
		() => channel.port1.close(),
		() => channel.port2.close(),
	)
	return {
		port: channel.port1,
		heard: async function heardAfterTurn() {
			await new Promise((resolve) => setTimeout(resolve, 0))
			return signals
		},
	}
}

describe('the engine’s heartbeat', () => {
	it('a client port added while dialecte code runs → told busy at once', async () => {
		const heartbeat = createHeartbeat({ intervalMs: 60_000 })
		heartbeat.busy()
		const { port, heard } = listenedPort()
		heartbeat.add(port)
		expect(await heard()).toEqual(['busy'])
	})

	it('a client port added while the engine is idle → told nothing until the next sign', async () => {
		const heartbeat = createHeartbeat({ intervalMs: 60_000 })
		const { port, heard } = listenedPort()
		heartbeat.add(port)
		expect(await heard()).toEqual([])
	})
})
