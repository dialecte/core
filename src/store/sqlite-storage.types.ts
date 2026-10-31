import type { SQLITE_STORAGE_KEY } from './sqlite-storage.constants'
import type { Store } from './store.types'

/** A project on `sqlite` storage: its name, its dialecte and the engine its factory gives. */
export type SqliteConnectorParams = {
	name: string
	dialecteId: string
	dialecteVersion: string
	/** The address of the dialecte's engine worker. */
	engineUrl: string
	/** Measure the import's and the export's stages in the engine (`dev.perf`). */
	perf?: boolean
}

/** The `sqlite` storage kind, as `@dialecte/core/sqlite` registers it. */
export type SqliteStorage = {
	/** The store of a project on `sqlite` storage: its engine in a worker, through the origin's hub or the page. */
	storeOf: (params: { connector: SqliteConnectorParams }) => Store
}

/** `globalThis` as it holds the registered `sqlite` storage kind. */
export type SqliteStorageHolder = { [SQLITE_STORAGE_KEY]?: SqliteStorage }
