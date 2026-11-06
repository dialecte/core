import { ENGINE_SIGNAL } from '../engine.constants'
import { fromThrownData } from '../wire/error-envelope'
import { UNANSWERED } from './client.constants'
import { watchHeartbeat } from './heartbeat-watch'

import { createDialecteError } from '@/errors'

import type { EngineControlAnswer, EngineLifeSignal } from '../engine.types'
import type { EngineControl, PendingControlRequest, SilenceWatch } from './client.types'

/** The control messages of one engine worker: each request answered once, by its id. */
export function createEngineControl(params: { worker: Worker }): EngineControl {
	const { worker } = params
	const pending = new Map<number, PendingControlRequest>()
	let nextRequestId = 0
	let isOpen = false
	/** Set once the realm ended or lost the worker: every request refused with it. */
	let ended: unknown
	/**
	 * Whether the engine said last that it runs dialecte code that may take long with nothing to tell (`busy`,
	 * until its next heartbeat): only its signals move it, never an answer.
	 */
	let busy = false
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
		function answerRequest(event: MessageEvent<EngineControlAnswer | EngineLifeSignal>) {
			const message = event.data
			if (message?.type === ENGINE_SIGNAL.busy) busy = true
			if (message?.type === ENGINE_SIGNAL.heartbeat) busy = false
			// a sign of life answers no request
			if (!message || !('requestId' in message)) return
			const answer = message
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
		watchSilence: function watchSilence({ budgetMs }) {
			return watchEngineSilence({ worker, busy, budgetMs })
		},
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

/**
 * The engine silent for `budgetMs` on its control channel while not busy (`watchHeartbeat`, the same judge
 * as a client port's): `silent` settles then.
 */
function watchEngineSilence(params: {
	worker: Worker
	busy: boolean
	budgetMs: number
}): SilenceWatch {
	const { worker, busy, budgetMs } = params
	let markSilent: () => void = settleNothing
	const silent = new Promise<void>(function waitForSilence(resolve) {
		markSilent = resolve
	})
	const watch = watchHeartbeat({
		source: worker,
		timeoutMs: budgetMs,
		waiting: oneWaiting,
		lose: markSilent,
		busy,
	})
	watch.restart()
	return { silent, stop: watch.stop }
}

/** What a silence watch on the control channel waits for: the one request it was made for. */
function oneWaiting(): number {
	return 1
}

/**
 * `work`'s answer, or `UNANSWERED` once the engine has been silent for `budgetMs` while not busy (a busy
 * engine is never taken for a lost one): what a realm waits a control request with.
 */
export async function answeredOrSilent<GenericAnswer>(params: {
	control: EngineControl
	work: Promise<GenericAnswer>
	budgetMs: number
}): Promise<GenericAnswer | typeof UNANSWERED> {
	const { control, work, budgetMs } = params
	const watch = control.watchSilence({ budgetMs })
	const silent = watch.silent.then(function unanswered(): typeof UNANSWERED {
		return UNANSWERED
	})
	try {
		return await Promise.race([work, silent])
	} finally {
		watch.stop()
	}
}

function settleNothing(): void {}
