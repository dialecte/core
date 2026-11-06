import { SQLITE_WASM_URL } from '../sqlite-wasm-url'

import { createWorkerConnector } from '@/store/sqlite/served/client/worker-connector'

import type { SqliteWorkerConnectorParams } from './sqlite-worker-connector.types'
import type { EngineConnector } from '@/store/sqlite/served/engine-store.types'

/**
 * Direct mode on SQLite: the project's engine in the app's engine worker (`serveSqliteEngine`),
 * opened on the consumer's one SQLite wasm file.
 */
export function createSqliteWorkerConnector(params: SqliteWorkerConnectorParams): EngineConnector {
	const { options, progressBeatOps, ...connector } = params
	return createWorkerConnector({
		...connector,
		settings: { wasmUrl: SQLITE_WASM_URL, options, progressBeatOps },
	})
}
