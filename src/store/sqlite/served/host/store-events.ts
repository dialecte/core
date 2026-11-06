import { ENGINE_SIGNAL } from '../engine.constants'
import { STORE_EVENT_OF_MEMBER } from './store-events.constants'

import type { AnnouncedCall, EngineEventSignal, StoreEvents } from './host.types'

/**
 * The change a member's success makes, as every client of the engine is told it: the project event (its timestamp
 * now), the connection the call was made for, and the call's write id; none when it changed nothing.
 */
export function storeEventOf(params: AnnouncedCall): EngineEventSignal | undefined {
	const { member, args, value, connectionId } = params
	const message = STORE_EVENT_OF_MEMBER[member]?.({ args, value })
	if (!message) return undefined
	const writeId = writeIdOf({ args })
	return {
		type: ENGINE_SIGNAL.event,
		message: { ...message, timestamp: Date.now() },
		connectionId,
		...(writeId !== undefined && { writeId }),
	}
}

/** The write id a call carries (a commit's, an import's: their params' `writeId`). */
function writeIdOf(params: { args: unknown[] }): string | undefined {
	const [first] = params.args
	if (typeof first !== 'object' || first === null || !('writeId' in first)) return undefined
	const { writeId } = first as { writeId: unknown }
	return typeof writeId === 'string' ? writeId : undefined
}

/**
 * The engine's announcer: each change posted on every client port it serves now (`ports`), the caller's
 * included - on the caller's port before its call's answer. A port that cannot take it (closed) is skipped.
 */
export function createStoreEvents(params: { ports: () => Iterable<MessagePort> }): StoreEvents {
	const { ports } = params
	let closed = false
	return {
		announce: function announce(call) {
			if (closed) return
			const signal = storeEventOf(call)
			if (!signal) return
			for (const port of ports()) {
				try {
					port.postMessage(signal)
				} catch {
					// a port gone: its client hears nothing more of this engine
				}
			}
		},
		close: function stopAnnouncing() {
			closed = true
		},
	}
}
