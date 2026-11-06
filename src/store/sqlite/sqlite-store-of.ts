import { createSqliteConnector } from './adapter/sqlite-connector'
import { EngineStore } from './served/engine-store'
import { registeredSqliteEngine } from './sqlite-engine-registration'

import type { Store } from '../store.types'
import type { SqliteConnectorParams } from './sqlite-storage.types'

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
