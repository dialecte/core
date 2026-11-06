import { refuseUnnamableProject } from './project-name'
import { registeredSqliteStorage } from './sqlite/sqlite-storage'

import { throwDialecteError } from '@/errors'
import { DexieStore, InMemoryStore } from '@/store'

import type { StorageParam } from '../project/types'
import type { SqliteConnectorParams } from './sqlite/sqlite-storage.types'
import type { Perf } from '@/perf'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { Store } from '@/store'

/**
 * Resolve the Store instance from open params.
 * 'local' creates a DexieStore; 'inMemory' creates an InMemoryStore - both import and export with `runtime`;
 * 'sqlite' the store of the kind `@dialecte/core/sqlite` registers - an EngineStore on the app's SQLite engine, which
 * imports and exports with its own (`PROJECT_SQLITE_NOT_IMPORTED` when the app never imported that entry; a project
 * made by no dialecte's factory is refused `PROJECT_ENGINE_NOT_DECLARED`);
 * 'custom' passes through the user-provided store, which imports and exports with its own.
 *
 * @internal store selection when a project opens; callers pass `storage` to the project factory
 */
export function resolveStore(params: {
	name: string
	storage: StorageParam
	/** The dialecte the store imports and exports with; its default config gives the local store's record schema */
	runtime: StoreRuntime
	perf?: Perf
	/** The project's dialecte: with the name, which project the in-memory and SQLite stores hold. */
	dialecteId?: string
}): Store {
	const { name, storage, runtime, perf, dialecteId } = params
	if (storage.type === 'local') {
		const config = runtime.configs[runtime.defaultConfigKey]
		return new DexieStore(name, {
			recordSchema: config.database.recordSchema,
			perf,
			runtime,
		})
	}
	if (storage.type === 'inMemory') {
		return new InMemoryStore(name, { writable: storage.writable ?? true, runtime, dialecteId })
	}
	if (storage.type === 'sqlite') {
		const sqlite = registeredSqliteStorage({ project: name })
		return sqlite.storeOf({ connector: sqliteConnectorParamsOf({ name, runtime, dialecteId }) })
	}
	return storage.store
}

/**
 * What a project on SQLite storage connects with: its name and its dialecte - a name or dialecte id no store can hold
 * refused `PROJECT_NAME_INVALID`, a project made by no factory (no dialecte id or version)
 * `PROJECT_ENGINE_NOT_DECLARED`. The engine it reaches is the one the app registered, read as it connects.
 */
export function sqliteConnectorParamsOf(params: {
	name: string
	runtime: StoreRuntime
	dialecteId: string | undefined
}): SqliteConnectorParams {
	const { name, runtime, dialecteId } = params
	const { dialecteVersion, perf } = runtime
	refuseUnnamableProject({ project: name, dialecteId })
	if (dialecteId === undefined || dialecteVersion === undefined) {
		throwDialecteError('PROJECT_ENGINE_NOT_DECLARED', {
			detail: `Project "${name}" asks for SQLite storage, but no dialecte's factory made it: no engine is known to start (dialecte ${dialecteId ?? 'none'}, version ${dialecteVersion ?? 'none'})`,
			meta: { project: name, dialecteId, dialecteVersion },
		})
	}
	return { name, dialecteId, dialecteVersion, perf }
}
