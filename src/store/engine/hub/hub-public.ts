import { adoptHubConnection, openHubConnection } from './hub-client'

import type { ConnectHubParams, HubConnection, HubRealm } from './hub-client.types'

/**
 * Connect this page to the origin's hub, once: a second call - from this copy of the library or
 * another one of the same protocol - gets the same connection. Answers `undefined` where the browser
 * has no SharedWorker, or the hub never welcomed the page (its script failed to load or was blocked, or
 * it stayed silent): a later call tries again. A hub of another protocol refuses the page:
 * `STORE_PROTOCOL_MISMATCH`. The page registers the engines it can start whose worker is of its own
 * origin.
 */
export async function connectHub(params: ConnectHubParams = {}): Promise<HubRealm | undefined> {
	const connection = await openHubConnection(params)
	return connection && toHubRealm({ connection })
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
