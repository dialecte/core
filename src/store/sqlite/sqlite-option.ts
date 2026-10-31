import { createDialecteError } from '@/errors'

import type { EngineConnector } from '../engine/engine-store.types'
import type { SqliteConnectorModule, SqliteConnectorParams } from './sqlite-option.types'

/**
 * The connector of a project on `sqlite` storage, its code loaded at the first connect or destroy (`import()`): a
 * page whose projects stay on another storage never loads the SQLite engine's side or its wasm. A module that cannot
 * be loaded (offline, a chunk gone after a deploy) refuses `STORE_CONNECTION_FAILED`.
 */
export function createLazySqliteConnector(params: {
	connector: SqliteConnectorParams
	load?: () => Promise<SqliteConnectorModule>
}): EngineConnector {
	const { connector, load = loadSqliteConnector } = params
	let loading: Promise<EngineConnector> | undefined
	function loaded(): Promise<EngineConnector> {
		loading ??= load().then(
			function connectorOf(module) {
				return module.createSqliteConnector(connector)
			},
			function refuseUnloaded(thrown: unknown) {
				// the next call tries again
				loading = undefined
				throw createDialecteError('STORE_CONNECTION_FAILED', {
					detail: `The SQLite engine's side could not be loaded for project "${connector.name}": ${thrown instanceof Error ? thrown.message : String(thrown)}`,
					meta: { project: connector.name },
					cause: thrown instanceof Error ? thrown : undefined,
				})
			},
		)
		return loading
	}
	return {
		connect: async function connectOnceLoaded() {
			const loadedConnector = await loaded()
			return loadedConnector.connect()
		},
		destroy: async function destroyOnceLoaded(destroyParams) {
			const loadedConnector = await loaded()
			return loadedConnector.destroy(destroyParams)
		},
	}
}

function loadSqliteConnector(): Promise<SqliteConnectorModule> {
	return import('./adapter/sqlite-connector')
}
