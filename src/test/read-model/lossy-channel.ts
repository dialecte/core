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
	/** The types dropped, each with the drops still waiting to be reached. */
	const dropped = new Map<string, Array<() => void>>()
	const heldTypes = new Set<string>()
	const held: Array<() => void> = []

	/** What becomes of a message posted: sent, held or lost. */
	function route(params: { message: unknown; send: () => void }): void {
		const type = typeOf(params.message)
		const drops = type === undefined ? undefined : dropped.get(type)
		if (drops) {
			for (const reached of drops.splice(0)) reached()
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
			const drops = dropped.get(params.type) ?? []
			dropped.set(params.type, drops)
			const reached = new Promise<void>(function onFirstDrop(resolve) {
				drops.push(resolve)
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

/** The project message type a posted message carries, if it is one. */
function typeOf(message: unknown): ProjectChannelMessage['type'] | undefined {
	if (typeof message !== 'object' || message === null || !('type' in message)) return undefined
	const { type } = message as { type: unknown }
	return typeof type === 'string' ? (type as ProjectChannelMessage['type']) : undefined
}
