import { CONTRACT_CLIENT_GONE_CHANNEL, CONTRACT_ENGINE_CHANNEL } from './store-contract.constants'
import { CONTRACT_DIALECTE } from './store-contract.dialecte'

import { serveSqliteEngine } from '@/sqlite'

import type {
	ContractClientGoneNotice,
	ContractControlAnswer,
	ContractControlMessage,
	ContractEngineOrder,
} from './store-contract.types'

/** The project this engine worker serves: a case's end order names it. */
let servedProject: string | undefined

self.addEventListener(
	'message',
	function noteServedProject(event: MessageEvent<ContractControlMessage>) {
		const { type, project } = event.data ?? {}
		// one project a worker: an open of another one while it serves is refused, the project served stays
		if (type === 'open' && servedProject === undefined) servedProject = project
		if (type === 'close' || type === 'destroy') servedProject = undefined
	},
)

/** The clients told gone, by the id of the request that told it: each is told on once the engine answers it. */
const goneByRequest = new Map<number, string>()

self.addEventListener(
	'message',
	function noteClientGone(event: MessageEvent<ContractControlMessage>) {
		const { type, clientId, requestId } = event.data ?? {}
		if (type === 'client-gone' && clientId !== undefined && requestId !== undefined) {
			goneByRequest.set(requestId, clientId)
		}
	},
)

// the engine's answers, watched: once it answers a client gone (its imports and exports aborted, after any control
// message queued before it), that client is told gone on the fixture's channel
const postToRealm = self.postMessage.bind(self)
self.postMessage = function postThenTellClientGone(
	message: ContractControlAnswer,
	...rest: unknown[]
): void {
	;(postToRealm as (message: unknown, ...rest: unknown[]) => void)(message, ...rest)
	const clientId =
		message?.requestId === undefined ? undefined : goneByRequest.get(message.requestId)
	if (message?.type !== 'released' || clientId === undefined) return
	goneByRequest.delete(message.requestId!)
	const channel = new BroadcastChannel(CONTRACT_CLIENT_GONE_CHANNEL)
	channel.postMessage({ type: 'client-gone', clientId } satisfies ContractClientGoneNotice)
	channel.close()
} as typeof self.postMessage

new BroadcastChannel(CONTRACT_ENGINE_CHANNEL).onmessage = function obey(
	event: MessageEvent<ContractEngineOrder>,
) {
	// ended as an engine that dies: nothing answered, nothing closed
	if (event.data.type === 'end' && event.data.project === servedProject) self.close()
}

serveSqliteEngine({ dialectes: [CONTRACT_DIALECTE] })
