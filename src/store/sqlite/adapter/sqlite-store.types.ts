import type { SqliteEngine, SqliteEngineApi, SqliteEngineOptions } from '../engine/engine.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** One connection of a store to its project's engine. */
export type SqliteEngineLink = {
	/** The engine serving the project now: a later call may answer another one, started since. */
	engine: () => Promise<SqliteEngineApi>
	/**
	 * Release the connection; the engine closes once no connection is left. Idempotent; the released
	 * connection reaches no engine after (`STORE_CLOSED`).
	 */
	close: () => void
}

/** How a store reaches its project's engine, and how the project is deleted. */
export type SqliteEngineConnector = {
	connect: () => Promise<SqliteEngineLink>
	/** Delete the project's file, its engine closed first; the next connection starts on a new file. */
	destroy: () => Promise<void>
}

export type SqliteStoreParams = {
	/** The project's name. */
	name: string
	connector: SqliteEngineConnector
}

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
