import type { SqliteEngineSettings } from '../runtime/runtime.types'
import type { WorkerConnectorParams } from '@/store/sqlite/served/client/client.types'

/** A worker connector to a SQLite engine: the engine's options and progress beat beside the connector's own. */
export type SqliteWorkerConnectorParams = Omit<
	WorkerConnectorParams<SqliteEngineSettings>,
	'settings'
> &
	Omit<SqliteEngineSettings, 'wasmUrl'>
