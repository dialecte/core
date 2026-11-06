import type { Store } from '../store.types'
import type { SQLITE_STORAGE_KEY } from './sqlite-storage.constants'

/** A project on `sqlite` storage: its name and its dialecte; its engine comes from what the app registered. */
export type SqliteConnectorParams = {
	name: string
	dialecteId: string
	dialecteVersion: string
	/** Measure the import's and the export's stages in the engine (`dev.perf`). */
	perf?: boolean
}

/** The engine an app registers: its one worker file and the dialectes that worker serves. */
export type SqliteEngineRegistration = {
	/** The address of the app's engine worker file: a `?worker&url` import of it. */
	url: string
	/**
	 * Every dialecte the worker file serves (`serveSqliteEngine({ dialectes })`): their declarations fit, only the id
	 * and the version of each are kept.
	 */
	dialectes: readonly { id: string; version: string }[]
}

/** The `sqlite` storage kind, as `@dialecte/core/sqlite` registers it. */
export type SqliteStorage = {
	/** The engine the app registered with `registerSqliteEngine`; none until then. */
	engine?: SqliteEngineRegistration
	/** The store of a project on `sqlite` storage: its engine in a worker, through the origin's hub or the page. */
	storeOf: (params: { connector: SqliteConnectorParams }) => Store
}

/** `globalThis` as it holds the registered `sqlite` storage kind. */
export type SqliteStorageHolder = { [SQLITE_STORAGE_KEY]?: SqliteStorage }
