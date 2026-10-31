import { createHubConnector } from '../../engine/client/hub-connector'
import { runsDirectly } from '../../engine/client/worker-connector'
import { openHubConnection } from '../../engine/hub/hub-client'
import { sqliteHubSpawner } from './sqlite-hub-spawner'
import { createSqliteWorkerConnector } from './sqlite-worker-connector'

import { throwDialecteError } from '@/errors'

import type { EngineConnector } from '../../engine/engine-store.types'
import type { SqliteConnectorParams } from '../../sqlite-storage.types'

/**
 * A project on `sqlite` storage: its engine reached through the origin's hub when the page has one (the store's own
 * engine offered to it as it connects, so a page that never called `connectHub` still hosts), else run by this page
 * (direct mode). Chosen per connection - a project the page runs directly already is joined there, whatever the hub
 * says by then - and a page the hub never welcomed asks it again at its next connection. A destroy goes the way a
 * connection would. Where the browser gives no worker or no private file system (Node, a private window) it refuses
 * `STORE_UNAVAILABLE`, nothing started.
 */
export function createSqliteConnector(params: SqliteConnectorParams): EngineConnector {
	const { name, dialecteId, dialecteVersion, engineUrl, perf } = params
	const direct = createSqliteWorkerConnector({ name, dialecteId, dialecteVersion, engineUrl, perf })

	/** The hub's connector when the page reaches a hub (this project's engine offered to it), else none. */
	async function hubConnector(): Promise<EngineConnector | undefined> {
		const connection = await openHubConnection({
			spawners: [sqliteHubSpawner({ dialecteId, dialecteVersion, engineUrl, perf })],
		})
		return (
			connection && createHubConnector({ name, connection, dialecteId, dialecteVersion, engineUrl })
		)
	}

	/** The way a connection or a destroy goes: direct when the page runs the project already or has no hub. */
	async function chosen(): Promise<EngineConnector> {
		await refuseWithoutStorage({ name })
		if (runsDirectly({ name, dialecteId })) return direct
		return (await hubConnector()) ?? direct
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
 * `STORE_UNAVAILABLE` where the realm can run no engine: no worker, or no origin private file system - none at all, or
 * one the browser refuses (a private Firefox window answers `getDirectory` with a refusal).
 */
async function refuseWithoutStorage(params: { name: string }): Promise<void> {
	const hasWorker = typeof Worker !== 'undefined'
	const hasFileSystem = hasWorker && (await opensFileSystem())
	if (hasFileSystem) return
	throwDialecteError('STORE_UNAVAILABLE', {
		detail: `Project "${params.name}" cannot be stored with SQLite here: this ${hasWorker ? 'browser gives no private file system' : 'environment has no worker'}`,
		meta: { project: params.name },
	})
}

/** Whether the browser hands this page its origin private file system. */
async function opensFileSystem(): Promise<boolean> {
	const storage = globalThis.navigator?.storage
	if (typeof storage?.getDirectory !== 'function') return false
	try {
		await storage.getDirectory()
		return true
	} catch {
		return false
	}
}
