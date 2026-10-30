import { CONTRACT_ENGINE_CHANNEL } from './store-contract.constants'
import { CONTRACT_DIALECTE } from './store-contract.dialecte'

import { serveDialecteEngine } from '@/engine'

import type { ContractControlMessage, ContractEngineOrder } from './store-contract.types'

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

new BroadcastChannel(CONTRACT_ENGINE_CHANNEL).onmessage = function obey(
	event: MessageEvent<ContractEngineOrder>,
) {
	// ended as an engine that dies: nothing answered, nothing closed
	if (event.data.type === 'end' && event.data.project === servedProject) self.close()
}

serveDialecteEngine({ dialecte: CONTRACT_DIALECTE })
