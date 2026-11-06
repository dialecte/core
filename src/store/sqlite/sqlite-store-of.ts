import { createSqliteConnector } from './adapter/sqlite-connector'
import { EngineStore } from './served/engine-store'
import { sqliteConnectorParamsOf } from './sqlite-connector-params'
import { registeredSqliteEngine } from './sqlite-engine-registration'

import type { Store } from '../store.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'

/**
 * The store of a project on `sqlite` storage: an EngineStore whose engine runs in a worker (hub or page), the worker
 * the app registered read when the project connects; what it connects with as `sqliteConnectorParamsOf` answers it.
 */
export function sqliteStoreOf(params: {
	name: string
	runtime: StoreRuntime
	dialecteId?: string
}): Store {
	const { name, runtime, dialecteId } = params
	const connector = sqliteConnectorParamsOf({ name, runtime, dialecteId })
	return new EngineStore({
		name,
		connector: createSqliteConnector({ ...connector, engine: registeredSqliteEngine }),
	})
}
