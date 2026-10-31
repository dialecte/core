import { ENGINE_SIGNAL } from '../engine.constants'
import { UNANSWERED } from './client.constants'
import { answeredOrSilent, createEngineControl } from './engine-control'

import { afterEach, describe, expect, it, vi } from 'vitest'

/** A worker the case speaks for: what it posts reaches the control as the engine's messages would. */
function fakeWorker(): { worker: Worker; say: (message: unknown) => void } {
	const target = new EventTarget()
	const worker = Object.assign(target, {
		postMessage: function swallow() {},
		terminate: function stop() {},
	}) as unknown as Worker
	return {
		worker,
		say: function say(message) {
			target.dispatchEvent(new MessageEvent('message', { data: message }))
		},
	}
}

/** A request that never answers: what an adoption waits on. */
function neverAnswered(): Promise<never> {
	return new Promise(function waitForever() {})
}

afterEach(() => {
	vi.useRealTimers()
})

describe('an engine control waiting on a silent engine', () => {
	type TestCase = {
		/** what the engine said on the channel before the wait */
		said: unknown[]
		expected: 'silent' | 'waiting'
	}
	const testCases: Record<string, TestCase> = {
		'nothing said → silent once the budget has passed': { said: [], expected: 'silent' },
		'`busy` said → still waiting past the budget: dialecte code running long': {
			said: [{ type: ENGINE_SIGNAL.busy }],
			expected: 'waiting',
		},
		'`busy`, then an answer to another request → still waiting: an answer never ends the busy phase':
			{
				said: [{ type: ENGINE_SIGNAL.busy }, { type: 'adopted', requestId: 99 }],
				expected: 'waiting',
			},
		'`busy`, then a heartbeat → silent once the budget has passed': {
			said: [{ type: ENGINE_SIGNAL.busy }, { type: ENGINE_SIGNAL.heartbeat }],
			expected: 'silent',
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, async () => {
			vi.useFakeTimers()
			const { worker, say } = fakeWorker()
			const control = createEngineControl({ worker })
			for (const message of testCase.said) say(message)
			let outcome: 'waiting' | 'silent' = 'waiting'
			void answeredOrSilent({ control, work: neverAnswered(), budgetMs: 100 }).then(
				function settled(answer) {
					if (answer === UNANSWERED) outcome = 'silent'
				},
			)
			await vi.advanceTimersByTimeAsync(1_000)
			expect(outcome).toBe(testCase.expected)
		})
	}
})
