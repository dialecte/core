import { fromThrownData } from '../wire/error-envelope'

import { createDialecteError } from '@/errors'

import type { EngineControlAnswer } from '../engine.types'
import type { EngineControl } from './client.types'

/** The control messages of one engine worker: each request answered once, by its id. */
export function createEngineControl(params: { worker: Worker }): EngineControl {
	const { worker } = params
	const pending = new Map<
		number,
		{
			expect: string
			resolve: (answer: EngineControlAnswer) => void
			reject: (thrown: unknown) => void
		}
	>()
	let nextRequestId = 0
	let isOpen = false
	/** Set once the realm ended or lost the worker: every request refused with it. */
	let ended: unknown
	worker.addEventListener('error', function refuseUnstartedWorker(event: ErrorEvent) {
		if (isOpen) return
		const failure = createDialecteError('PROJECT_ENGINE_UNAVAILABLE', {
			detail: `The project engine worker could not start: ${event.message || 'its script failed to load'}`,
			cause: new Error(event.message || 'worker error'),
		})
		for (const waiting of pending.values()) waiting.reject(failure)
		pending.clear()
	})
	worker.addEventListener(
		'message',
		function answerRequest(event: MessageEvent<EngineControlAnswer>) {
			const answer = event.data
			const waiting = pending.get(answer.requestId)
			if (!waiting) return
			pending.delete(answer.requestId)
			if (answer.type === 'failed') waiting.reject(fromThrownData({ data: answer.thrown }))
			else if (answer.type === waiting.expect) waiting.resolve(answer)
			else {
				waiting.reject(
					createDialecteError('ASSERTION_FAILED', {
						detail: `The engine answered "${answer.type}" where "${waiting.expect}" was expected`,
					}),
				)
			}
		},
	)
	return {
		opened: function markOpened() {
			isOpen = true
		},
		end: function endControl({ error }) {
			ended = error
			for (const waiting of pending.values()) waiting.reject(error)
			pending.clear()
		},
		request: function requestControl({ message, expect, transfer = [] }) {
			nextRequestId += 1
			const requestId = nextRequestId
			return new Promise(function awaitAnswer(resolve, reject) {
				if (ended !== undefined) {
					reject(ended)
					return
				}
				pending.set(requestId, {
					expect,
					resolve: resolve as (answer: EngineControlAnswer) => void,
					reject,
				})
				worker.postMessage({ ...message, requestId }, transfer)
			})
		},
	}
}
