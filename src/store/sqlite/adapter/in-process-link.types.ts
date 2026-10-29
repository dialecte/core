import type { SqliteEngine, SqliteEngineOptions } from '../engine/engine.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

export type InProcessConnectorParams = {
	/** The project's name: one in-memory file per name in the realm. */
	name: string
	/** The dialecte kept in a new file. */
	dialecteId: string
	/** What the name's engine imports with, when this connection starts it. */
	runtime?: StoreRuntime
	options?: Partial<SqliteEngineOptions>
}

/**
 * The in-memory file of a name and its engine: a connection keeps the file while no engine runs on it,
 * as the file system keeps a project's file between two engines.
 */
export type InProcessFile = {
	keeper: Database
	engine?: SqliteEngine
}
