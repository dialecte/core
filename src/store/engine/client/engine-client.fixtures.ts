import { createEngineClient } from './engine-client'

import { toDialecteError } from '@/errors'

/** What a call ended with: `'resolved'`, or the key and meta of the error it was refused with. */
export async function outcomeOf(action: Promise<unknown>): Promise<unknown> {
	try {
		await action
		return 'resolved'
	} catch (thrown) {
		const error = toDialecteError(thrown)
		return { key: error?.key ?? String(thrown), meta: error?.meta }
	}
}

/**
 * A client watching its port for 300 ms of silence; its other end returned to play the engine. What it leaves
 * (the client closed, the port closed) goes in `cleanups`.
 */
export function watchedClient(params: { cleanups: (() => void)[] }): {
	client: ReturnType<typeof createEngineClient>
	engineSide: MessagePort
} {
	const channel = new MessageChannel()
	const client = createEngineClient({ port: channel.port1, heartbeatTimeoutMs: 300 })
	params.cleanups.push(
		() => client.close({ storeName: 'watched' }),
		() => channel.port2.close(),
	)
	return { client, engineSide: channel.port2 }
}
