import { refuseUnnamableProject } from '../../project-name'
import { ENGINE_OPEN_BUDGET_MS } from './client.constants'
import { destroyFromFreshWorker } from './worker-connector'

import type { EngineConnector, EngineLink } from '../engine-store.types'
import type { EngineApi } from '../engine.types'
import type { HubProjectLink } from '../hub/hub-client.types'
import type { EngineClient } from './client.types'
import type { HubConnectorParams } from './hub-connector.types'

/** The hub link behind each link a store holds: its own destroy counts the realm's others without it. */
const HUB_LINKS = new WeakMap<EngineLink, HubProjectLink>()

/**
 * A project's engine reached through the origin's hub: the hub elects the realm that hosts it and hands
 * this realm a port to it; a call made before the hub answered waits for its answer. The connection's
 * engine is the one the realm holds now: after its host is gone, the next one. The project is destroyed
 * once the hub grants it (no other view uses it), by a fresh worker that waits for the lock of the
 * engine the hub just released - in this realm, or (`deletesFiles: false`) in a view the hub picks.
 */
export function createHubConnector(params: HubConnectorParams): EngineConnector {
	refuseUnnamableProject({ project: params.name, dialecteId: params.dialecteId })
	const {
		name,
		connection,
		dialecteId,
		dialecteVersion,
		engineUrl,
		destroyBudgetMs = ENGINE_OPEN_BUDGET_MS,
		heartbeatTimeoutMs,
		deletesFiles = true,
	} = params
	return {
		connect: async function connectThroughHub() {
			const link = connection.openProject({
				project: name,
				dialecteId,
				dialecteVersion,
				heartbeatTimeoutMs,
			})
			try {
				await link.engine()
			} catch (thrown) {
				void link.release()
				throw thrown
			}
			// the realm's one port to the engine serves each of its connections: each call names this one
			const connectionId = crypto.randomUUID()
			/** This connection's view of each engine client the realm holds (a new one after a failover). */
			const views = new WeakMap<EngineClient, EngineApi>()
			const engineLink: EngineLink = {
				engine: async function currentEngine() {
					const client = await link.engine()
					const view = views.get(client) ?? client.connection({ connectionId })
					views.set(client, view)
					return view
				},
				connectionId,
				onNotice: link.onNotice,
				close: link.release,
			}
			HUB_LINKS.set(engineLink, link)
			return engineLink
		},
		destroy: function destroyThroughHub(destroyParams) {
			const own = destroyParams?.own
			const hubLink = own && HUB_LINKS.get(own.link)
			return connection.destroyProject({
				project: name,
				dialecteId,
				own: own && hubLink && { link: hubLink, letGo: own.letGo },
				// a realm that cannot store names no files to delete: the hub has another view delete them
				destroy: deletesFiles
					? function destroyFiles() {
							return destroyFromFreshWorker({
								name,
								dialecteId,
								engineUrl,
								budgetMs: destroyBudgetMs,
								lock: 'wait',
							})
						}
					: undefined,
			})
		},
	}
}
