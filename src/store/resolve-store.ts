import { registeredStorageKind } from './storage-kinds'

import { DexieStore, InMemoryStore } from '@/store'

import type { StorageParam } from '../project/types'
import type { Perf } from '@/perf'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { Store } from '@/store'

/**
 * Resolve the Store instance from open params: core's own kinds first - 'local' creates a DexieStore, 'inMemory' an
 * InMemoryStore (both import and export with `runtime`), 'custom' passes through the user-provided store, which
 * imports and exports with its own -, then the kind registered for the type (`registerStorageKind`), which builds the
 * store from the name, the storage, the runtime and the dialecte id; a type no kind is registered for in this realm is
 * refused `PROJECT_STORAGE_NOT_REGISTERED`.
 *
 * @internal store selection when a project opens; callers pass `storage` to the project factory
 */
export function resolveStore(params: {
	name: string
	storage: StorageParam
	/** The dialecte the store imports and exports with; its default config gives the local store's record schema */
	runtime: StoreRuntime
	perf?: Perf
	/** The project's dialecte: with the name, which project the in-memory store and a registered kind's store hold. */
	dialecteId?: string
}): Store {
	const { name, storage, runtime, perf, dialecteId } = params
	// Read before the built-ins narrow `storage`: when no entry (such as `@dialecte/core/sqlite`) declares a kind beyond
	// them, it narrows to never.
	const { type } = storage
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
	if (storage.type === 'custom') return storage.store
	const kind = registeredStorageKind({ project: name, type })
	return kind.storeOf({ name, storage, runtime, dialecteId, perf })
}
