import { createHubConnector } from '../../engine/client/hub-connector'
import { runsDirectly } from '../../engine/client/worker-connector'
import { keptHubConnection, openHubConnection } from '../../engine/hub/hub-client'
import { refuseWithoutStorage, storesHere } from './realm-storage'
import { sqliteHubSpawner } from './sqlite-hub-spawner'
import { createSqliteWorkerConnector } from './sqlite-worker-connector'

import type { EngineConnector } from '../../engine/engine-store.types'
import type { HubConnection } from '../../engine/hub/hub-client.types'
import type { SqliteConnectorParams } from '../../sqlite-storage.types'

/**
 * A project on `sqlite` storage: its engine reached through the origin's hub when the page has one (the store's own
 * engine offered to it as it connects, so a page that never called `connectHub` still hosts), else run by this page
 * (direct mode). Chosen per connection - a project the page runs directly already is joined there, whatever the hub
 * says by then - and a page the hub never welcomed asks it again at its next connection. A destroy goes the way a
 * connection would, and runs a worker of its own in this realm. Where the realm can run no engine (no worker, no
 * private file system: Node, a private window, a sandboxed or storage-blocked frame) it refuses `STORE_UNAVAILABLE`,
 * nothing started - but a child its page bound through `adoptHubPort` connects through the page's engine.
 */
export function createSqliteConnector(params: SqliteConnectorParams): EngineConnector {
	const { name, dialecteId, dialecteVersion, engineUrl, perf } = params
	const direct = createSqliteWorkerConnector({ name, dialecteId, dialecteVersion, engineUrl, perf })

	function throughHub(params: { connection: HubConnection }): EngineConnector {
		return createHubConnector({
			name,
			connection: params.connection,
			dialecteId,
			dialecteVersion,
			engineUrl,
		})
	}

	/**
	 * The way a connection or a destroy goes: direct when the page runs the project already or has no hub, else
	 * through the hub - this project's engine offered to it. A realm that cannot store starts nothing: a connection
	 * goes through the hub only as a child bound by its page (which hosts no engine), and a destroy, which runs a
	 * worker here, is refused.
	 */
	async function chosen(params: { destroying: boolean }): Promise<EngineConnector> {
		if (!(await storesHere())) {
			const bound = params.destroying ? undefined : await boundConnection()
			if (bound) return throughHub({ connection: bound })
			refuseWithoutStorage({ name })
		}
		if (runsDirectly({ name, dialecteId })) return direct
		const connection = await openHubConnection({
			spawners: [sqliteHubSpawner({ dialecteId, dialecteVersion, engineUrl, perf })],
		})
		return connection ? throughHub({ connection }) : direct
	}

	return {
		connect: async function connectToEngine() {
			const connector = await chosen({ destroying: false })
			return connector.connect()
		},
		destroy: async function destroyProject(destroyParams) {
			const connector = await chosen({ destroying: true })
			return connector.destroy(destroyParams)
		},
	}
}

/**
 * The realm's hub connection when its page bound it (`adoptHubPort`); none asked for otherwise. An adoption that
 * failed answers its own refusal (`STORE_CONNECTION_FAILED`: a port nobody answers).
 */
async function boundConnection(): Promise<HubConnection | undefined> {
	const connection = await keptHubConnection()
	return connection?.bound ? connection : undefined
}
