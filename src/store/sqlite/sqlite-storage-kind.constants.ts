import { SQLITE_STORAGE_KIND_ID } from './sqlite-storage.constants'
import { sqliteStoreOf } from './sqlite-store-of'

import type { StorageKind } from '../storage-kinds.types'

/**
 * The `sqlite` storage kind `@dialecte/core/sqlite` registers: a project's store is an EngineStore on the app's
 * registered SQLite engine, in a worker (through the origin's hub or the page), which imports and exports with its
 * own; a project made by no dialecte's factory is refused `PROJECT_ENGINE_NOT_DECLARED`. It carries no `testStoreOf`:
 * the in-process engine a test project opens on is core's test entry's (`@dialecte/core/test`), so a page that imports
 * this entry never reaches the engine or sqlite-wasm.
 */
export const SQLITE_STORAGE_KIND: StorageKind<'sqlite'> = {
	id: SQLITE_STORAGE_KIND_ID,
	storeOf: function sqliteKindStoreOf({ name, runtime, dialecteId }) {
		return sqliteStoreOf({ name, runtime, dialecteId })
	},
}
