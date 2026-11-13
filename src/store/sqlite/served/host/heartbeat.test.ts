import { createHeartbeat, withOpaquePhases } from './heartbeat'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SILENCE_WAIT_MS } from '@/test/test-timing.constants'

import type { AfterImportContext } from '@/types'

/** What a case leaves: its ports closed. */
const cleanups: (() => void)[] = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

/** A port the heartbeat may post on, and the signals its other end has heard so far. */
function listenedPort(): { port: MessagePort; signals: string[] } {
	const channel = new MessageChannel()
	const signals: string[] = []
	channel.port2.onmessage = function hear(event: MessageEvent<{ type: string }>) {
		signals.push(event.data.type)
	}
	cleanups.push(
		() => channel.port1.close(),
		() => channel.port2.close(),
	)
	return { port: channel.port1, signals }
}

describe('the engine’s heartbeat', () => {
	it('a client port added while dialecte code runs → told busy at once', async () => {
		const heartbeat = createHeartbeat({ intervalMs: 60_000 })
		heartbeat.busy()
		const { port, signals } = listenedPort()
		heartbeat.add(port)
		await vi.waitFor(function busyHeard() {
			expect(signals).toEqual(['busy'])
		})
	})

	it('a client port added while the engine is idle → told nothing until the next sign', async () => {
		const heartbeat = createHeartbeat({ intervalMs: 60_000 })
		const { port, signals } = listenedPort()
		heartbeat.add(port)
		// nothing to wait for: a bounded wait, longer than a message takes on a loaded machine
		await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))
		expect(signals).toEqual([])
	})
})

describe('the dialecte’s hooks with their opaque phases told', () => {
	it('an import session’s afterImport → handed the context core gives it, report and signal alike', async () => {
		const heartbeat = createHeartbeat({ intervalMs: 60_000 })
		const handed: (AfterImportContext | undefined)[] = []
		const hooks = withOpaquePhases({
			heartbeat,
			hooks: {
				createImportSession: () => ({
					afterImport: async (context) => {
						handed.push(context)
						return {}
					},
				}),
			},
		})
		const context: AfterImportContext = {
			report: function reportNothing() {},
			signal: new AbortController().signal,
		}
		const session = hooks?.createImportSession?.({ documentId: 'd-1', configKey: 'default' })
		await session?.afterImport?.(context)
		expect(handed).toEqual([context])
	})
})
