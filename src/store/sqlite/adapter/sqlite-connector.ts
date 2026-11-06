import { createHubConnector } from '../../engine/client/hub-connector'
import { runsDirectly } from '../../engine/client/worker-connector'
import { keptHubConnection, openHubConnection } from '../../engine/hub/hub-client'
import { refuseWithoutStorage, storesHere } from './realm-storage'
import { sqliteHubSpawnersOf } from './sqlite-hub-spawner'
import { createSqliteWorkerConnector } from './sqlite-worker-connector'

import { throwDialecteError } from '@/errors'

import type { EngineConnector } from '../../engine/engine-store.types'
import type { HubConnection } from '../../engine/hub/hub-client.types'
import type { SqliteEngineRegistration } from '../../sqlite-storage.types'
import type { CreateSqliteConnectorParams } from './sqlite-connector.types'

/**
 * A project on `sqlite` storage: its engine, in the worker the app registered, reached through the origin's hub when
 * the page has one (every engine the app registered offered to it as the project connects, so a page that never called
 * `connectHub` still hosts), else run by this page (direct mode). Chosen per connection - a project the page runs
 * directly already is joined there, whatever the hub says by then - and a page the hub never welcomed asks it again at
 * its next connection. A destroy goes the way a connection would, and runs a worker of its own in this realm. Where the
 * realm can run no engine (no worker, no private file system: Node, a private window, a sandboxed or storage-blocked
 * frame) it refuses `STORE_UNAVAILABLE`, and where the app registered no engine for the dialecte
 * `PROJECT_SQLITE_ENGINE_NOT_REGISTERED`, nothing started - but in either case a child its page bound through
 * `adoptHubPort` connects through the page's engine, and its destroys are deleted by a view of the origin that can store.
 */
export function createSqliteConnector(params: CreateSqliteConnectorParams): EngineConnector {
	const { name, dialecteId, dialecteVersion, perf, engine } = params
	/** The worker connector of direct mode: the same one for all this store's connections, made when one is needed. */
	let direct: EngineConnector | undefined

	function directOn(params: { engineUrl: string }): EngineConnector {
		direct ??= createSqliteWorkerConnector({
			name,
			dialecteId,
			dialecteVersion,
			engineUrl: params.engineUrl,
			perf,
		})
		return direct
	}

	function throughHub(params: { connection: HubConnection; engineUrl?: string }): EngineConnector {
		return createHubConnector({
			name,
			connection: params.connection,
			dialecteId,
			dialecteVersion,
			engineUrl: params.engineUrl,
		})
	}

	/**
	 * The way a connection or a destroy goes. A realm that cannot store, or with no engine registered for the dialecte,
	 * starts nothing: it goes through the hub only as a child bound by its page (a view of another origin is a client
	 * of the engines its shell starts and never registers), its destroys' files deleted by a view that can; else it is
	 * refused - for want of storage first, which registering would not help. Otherwise direct when the page runs the
	 * project already or has no hub, else through the hub, every engine the app registered offered to it.
	 */
	async function chosen(): Promise<EngineConnector> {
		const stores = await storesHere()
		const registration = stores ? namingDialecte({ registration: engine(), dialecteId }) : undefined
		if (!registration) {
			const bound = await boundConnection()
			if (bound) return throughHub({ connection: bound })
			if (!stores) refuseWithoutStorage({ name })
			refuseNotRegistered({ name, dialecteId })
		}
		const engineUrl = registration.url
		if (runsDirectly({ name, dialecteId })) return directOn({ engineUrl })
		const connection = await openHubConnection({
			spawners: sqliteHubSpawnersOf({ registration, own: { dialecteId, perf } }),
		})
		return connection ? throughHub({ connection, engineUrl }) : directOn({ engineUrl })
	}

	return {
		connect: async function connectToEngine() {
			const connector = await chosen()
			return connector.connect()
		},
		destroy: async function destroyProject(destroyParams) {
			const connector = await chosen()
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

/**
 * The registration when it names the dialecte. By id: a project of a registered dialecte at another version goes on,
 * and the engine, the hub or the page running the project's engine refuses it `PROJECT_DIALECTE_VERSION_MISMATCH`.
 */
function namingDialecte(params: {
	registration: SqliteEngineRegistration | undefined
	dialecteId: string
}): SqliteEngineRegistration | undefined {
	const { registration, dialecteId } = params
	const named = registration?.dialectes.some(function isTheDialecte({ id }) {
		return id === dialecteId
	})
	return named ? registration : undefined
}

/** `PROJECT_SQLITE_ENGINE_NOT_REGISTERED`: the app told this page of no engine worker for the dialecte. */
function refuseNotRegistered(params: { name: string; dialecteId: string }): never {
	const { name, dialecteId } = params
	throwDialecteError('PROJECT_SQLITE_ENGINE_NOT_REGISTERED', {
		detail: `Project "${name}" asks for SQLite storage, but no engine is registered for ${dialecteId}: call \`registerSqliteEngine({ url, dialectes })\` from '@dialecte/core/sqlite' once, before the first project opens, naming ${dialecteId} among the dialectes of the app's engine worker`,
		meta: { project: name, dialecteId },
	})
}
