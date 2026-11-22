import type { LossyChannel } from './read-model-harness.types'
import type { ProjectChannelMessage } from '@/project/types'

/**
 * Replaces the realm's BroadcastChannel until `restore`: a project message of a type can then be dropped (lost) or held
 * (late) as it is posted, and the held ones flushed in the order asked. Install it before the projects open; installs
 * nest, restored last first.
 *
 * @intent lose a project channel message in a test, deliver a change late or out of order
 */
export function installLossyChannel(): LossyChannel {
	const RealmChannel = globalThis.BroadcastChannel
	const dropped = new Set<string>()
	const heldTypes = new Set<string>()
	const held: Array<() => void> = []
	const drops = { reached: noOp }

	/** What becomes of a message posted: sent, held or lost. */
	function route(params: { message: unknown; send: () => void }): void {
		const type = typeOf(params.message)
		if (type !== undefined && dropped.has(type)) {
			drops.reached()
			return
		}
		if (type !== undefined && heldTypes.has(type)) {
			held.push(params.send)
			return
		}
		params.send()
	}

	// dialecte-allow class: the realm's BroadcastChannel is a constructor every project calls with `new`; only a subclass replaces it
	class LossyBroadcastChannel extends RealmChannel {
		override postMessage(message: unknown): void {
			const post = super.postMessage.bind(this)
			route({
				message,
				send: function sendNow() {
					post(message)
				},
			})
		}
	}

	globalThis.BroadcastChannel = LossyBroadcastChannel

	return {
		drop: function drop(params) {
			dropped.add(params.type)
			const reached = new Promise<void>(function onFirstDrop(resolve) {
				drops.reached = resolve
			})
			return { reached }
		},
		hold: function hold(params) {
			heldTypes.add(params.type)
		},
		flush: function flush(params) {
			heldTypes.clear()
			const sends = held.splice(0)
			for (const send of params?.reversed ? sends.reverse() : sends) send()
		},
		restore: function restore() {
			held.length = 0
			heldTypes.clear()
			// a later install restored first already gave the realm's channel back: never put this one's subclass back
			if (globalThis.BroadcastChannel === LossyBroadcastChannel)
				globalThis.BroadcastChannel = RealmChannel
		},
	}
}

/** Nothing, until a promise hands its resolver over. */
function noOp(): void {}

/** The project message type a posted message carries, if it is one. */
function typeOf(message: unknown): ProjectChannelMessage['type'] | undefined {
	if (typeof message !== 'object' || message === null || !('type' in message)) return undefined
	const { type } = message as { type: unknown }
	return typeof type === 'string' ? (type as ProjectChannelMessage['type']) : undefined
}
