import { storesHere } from './adapter/realm-storage'
import { sqliteHubSpawnersOf } from './adapter/sqlite-hub-spawner'
import { adoptHubConnection, openHubConnection } from './served/hub/hub-client'
import { registeredSqliteEngine } from './sqlite-engine-registration'

import type { HubConnection, HubRealm } from './served/hub/hub-client.types'

/**
 * Connect this page to the origin's hub, once, and get its connection (`HubRealm`: `realmId`, `createHubPort` to bind a
 * child frame, `onRejoined`, the moment to bind child frames again after a freeze or a drop): a second call - from this copy of the library or
 * another one of the same protocol - gets the same connection. Answers `undefined` where the browser
 * has no SharedWorker, or the hub never welcomed the page (its script failed to load or was blocked, or
 * it stayed silent): a later call tries again. A hub of another protocol refuses the page:
 * `STORE_PROTOCOL_MISMATCH`; the browser refusing to make the hub's worker (a `DOMException`) is no hub,
 * any other error thrown making it is thrown. The page offers the hub the engines the app registered
 * (`registerSqliteEngine`), one per dialecte on the one worker file, when that file is of its own origin; connecting
 * before registering is allowed and offers nothing - a later call adds those registered since, as a project opened on
 * `sqlite` does - so register first. A document that joined through `adoptHubPort` hosts no engine and offers none;
 * neither does a page that cannot store (no private file system): its own projects on `sqlite` are refused
 * `STORE_UNAVAILABLE` unless its page bound it, its connection serving to hand ports to its children. An engine's
 * files (the SQLite wasm) are fetched when the page first starts one.
 *
 * @intent connect a page to the origin's hub before any project opens, offer the engines an app registered to the hub, get a port to hand a child frame of another origin
 */
export async function connectHub(): Promise<HubRealm | undefined> {
	const stores = await storesHere()
	const connection = await openHubConnection({
		spawners: sqliteHubSpawnersOf({ registration: registeredSqliteEngine() }),
		// a page that cannot store offers no engine: elected to host one, it could not open it
		hostsNoEngine: !stores,
	})
	return connection && toHubRealm({ connection })
}

/**
 * Join the hub through a port a page made with `createHubPort` (a document that cannot reach the
 * hub's script), and get that document's connection: a client only, whose liveness is that page's. A port nobody answers fails the join
 * `STORE_CONNECTION_FAILED` once the welcome budget has passed. A document that connected already gets
 * its connection - `undefined` when that one found no hub. One the hub dropped with its page (its calls
 * refused `STORE_CONNECTION_LOST`, `realm-dropped`) joins again on the new port, on its own: the page makes
 * it one from `onRejoined`, and a join that fails leaves it dropped until the next one.
 *
 * @intent join the hub from an iframe of another origin, open projects on SQLite storage in a child frame through its page's engine, bind a child frame again after its page rejoined the hub
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
