import { adoptHubConnection, openHubConnection } from './engine/hub/hub-client'
import { loadSqliteEngineSettings } from './sqlite/adapter/sqlite-engine-settings'

import type { ConnectHubParams, HubConnection, HubRealm } from './engine/hub/hub-client.types'
import type { HubEngineSpawner, RealmEngineSpawner } from './engine/hub/realm-host.types'

/**
 * Connect this page to the origin's hub, once: a second call - from this copy of the library or
 * another one of the same protocol - gets the same connection. Answers `undefined` where the browser
 * has no SharedWorker, or the hub never welcomed the page (its script failed to load or was blocked, or
 * it stayed silent): a later call tries again. A hub of another protocol refuses the page:
 * `STORE_PROTOCOL_MISMATCH`; the browser refusing to make the hub's worker (a `DOMException`) is no hub,
 * any other error thrown making it is thrown. The page registers the engines it can start whose worker is of
 * its own origin (each dialecte's `factory.spawner`); a later call adds those it does not run yet, and one naming a dialecte the page runs at another version is
 * refused `STORE_HUB_SPAWNERS_FIXED`, the connection kept. A document that joined through `adoptHubPort` hosts no
 * engine: the spawners it names are not registered. An engine's files (the SQLite wasm) are fetched when the page
 * first starts one.
 */
export async function connectHub(params: ConnectHubParams = {}): Promise<HubRealm | undefined> {
	const spawners = params.spawners?.map(withDefaultSettings)
	const connection = await openHubConnection({ spawners })
	return connection && toHubRealm({ connection })
}

/** A dialecte's spawner as the page runs it: the SQLite engine opened on the consumer's wasm, loaded at spawn. */
function withDefaultSettings(spawner: HubEngineSpawner): RealmEngineSpawner {
	const { dialecteId, dialecteVersion, engineUrl } = spawner
	return { dialecteId, dialecteVersion, engineUrl, settings: loadDefaultSettings }
}

function loadDefaultSettings(): Promise<unknown> {
	return loadSqliteEngineSettings()
}

/**
 * Join the hub through a port a page made with `createHubPort` (a document that cannot reach the
 * hub's script): a client only, whose liveness is that page's. A port nobody answers fails the join
 * `STORE_CONNECTION_FAILED` once the welcome budget has passed. A document that connected already gets
 * its connection - `undefined` when that one found no hub. One the hub dropped with its page (its calls
 * refused `STORE_ENGINE_LOST`, `realm-dropped`) joins again on the new port, on its own: the page makes
 * it one from `onRejoined`, and a join that fails leaves it dropped until the next one.
 */
export async function adoptHubPort(params: { port: MessagePort }): Promise<HubRealm | undefined> {
	const connection = await adoptHubConnection(params)
	return connection && toHubRealm({ connection })
}

/** What a page may do with its connection; its projects go through the stores. */
function toHubRealm(params: { connection: HubConnection }): HubRealm {
	const { connection } = params
	return {
		realmId: connection.realmId,
		createHubPort: connection.createHubPort,
		onRejoined: connection.onRejoined,
	}
}
