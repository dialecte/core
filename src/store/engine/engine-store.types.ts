import type { EngineApi } from './engine.types'

/** One connection of a store to its project's engine. */
export type EngineLink = {
	/** The engine serving the project now: a later call may answer another one, started since. */
	engine: () => Promise<EngineApi>
	/**
	 * Release the connection; the engine closes once no connection is left. Idempotent; the released
	 * connection reaches no engine after (`STORE_CLOSED`).
	 */
	close: () => void
}

/** How a store reaches its project's engine, and how the project is deleted. */
export type EngineConnector = {
	connect: () => Promise<EngineLink>
	/** Delete the project's file, its engine closed first; the next connection starts on a new file. */
	destroy: () => Promise<void>
}

export type EngineStoreParams = {
	/** The project's name. */
	name: string
	connector: EngineConnector
}
