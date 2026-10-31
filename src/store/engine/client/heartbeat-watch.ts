import { ENGINE_SIGNAL } from '../engine.constants'

import { yieldToQueue } from '@/utils/yield-to-queue'

import type { HeartbeatWatch } from './client.types'

/**
 * The engine's silence while something waits on it (a call on a client port, an adoption on the worker's
 * control channel): any message from `source` (an answer, a beat) is a sign of life; `busy` holds the clock
 * from the engine's busy signal to its next heartbeat - `busy` when the watch starts, if the engine said so
 * last; none for `timeoutMs` while something waits loses the engine - once the messages queued meanwhile
 * have gone through (a message turn: the page may have stalled, or been frozen with its worker); the
 * document's `resume` and the page's `pageshow` restart the clock. The clock starts at the first `restart`.
 */
export function watchHeartbeat(params: {
	source: EventTarget
	timeoutMs: number
	waiting: () => number
	lose: () => void
	busy?: boolean
}): HeartbeatWatch {
	const { source, timeoutMs, waiting, lose } = params
	let heardAt = performance.now()
	let busy = params.busy ?? false
	let timer: ReturnType<typeof setTimeout> | undefined

	function hear(event: MessageEvent<{ type?: string } | undefined>): void {
		heardAt = performance.now()
		// only the engine's signals move `busy`: an answer to a call (this client's own, during the opaque phase) does not end it
		const type = event.data?.type
		if (type === ENGINE_SIGNAL.busy) busy = true
		if (type === ENGINE_SIGNAL.heartbeat) busy = false
		armIn({ delayMs: timeoutMs })
	}

	function restart(): void {
		heardAt = performance.now()
		armIn({ delayMs: timeoutMs })
	}

	/** One judge at a time: an armed timer stays until it fires. */
	function armIn(params: { delayMs: number }): void {
		if (timer !== undefined) return
		timer = setTimeout(judge, params.delayMs)
	}

	function judge(): void {
		timer = undefined
		if (waiting() === 0) return
		const silentFor = performance.now() - heardAt
		if (busy || silentFor < timeoutMs) {
			armIn({ delayMs: busy ? timeoutMs : timeoutMs - silentFor })
			return
		}
		// before a loss, the messages queued meanwhile go through first (a page stalled, or frozen with its worker)
		void yieldToQueue().then(judgeAfterTurn)
	}

	function judgeAfterTurn(): void {
		if (waiting() === 0 || timer !== undefined) return
		if (busy || performance.now() - heardAt < timeoutMs) {
			armIn({ delayMs: 0 })
			return
		}
		lose()
	}

	// `resume` is fired at the document and does not bubble; `pageshow` at the window
	const lifecycle = globalThis.document
	source.addEventListener('message', hear as EventListener)
	lifecycle?.addEventListener('resume', restart)
	globalThis.addEventListener?.('pageshow', restart)
	return {
		restart,
		stop: function stopWatching() {
			if (timer !== undefined) clearTimeout(timer)
			timer = undefined
			source.removeEventListener('message', hear as EventListener)
			lifecycle?.removeEventListener('resume', restart)
			globalThis.removeEventListener?.('pageshow', restart)
		},
	}
}
