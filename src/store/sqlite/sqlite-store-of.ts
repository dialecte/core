import { EngineStore } from '../engine/engine-store'
import { createSqliteConnector } from './adapter/sqlite-connector'
import { registeredSqliteEngine } from './sqlite-engine-registration'

import type { SqliteConnectorParams } from '../sqlite-storage.types'
import type { Store } from '../store.types'

/**
 * The store of a project on `sqlite` storage: an EngineStore whose engine runs in a worker (hub or page), the worker
 * the app registered read when the project connects.
 */
export function sqliteStoreOf(params: { connector: SqliteConnectorParams }): Store {
	const { connector } = params
	return new EngineStore({
		name: connector.name,
		connector: createSqliteConnector({ ...connector, engine: registeredSqliteEngine }),
	})
}
