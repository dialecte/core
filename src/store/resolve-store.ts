import { DexieStore, InMemoryStore } from '@/store'

import type { StorageParam } from '../project/types'
import type { Perf } from '@/perf'
import type { ImportRuntime } from '@/project/io/run-import.types'
import type { Store } from '@/store'

/**
 * Resolve the Store instance from open params.
 * 'local' creates a DexieStore; 'inMemory' creates an InMemoryStore - both import with `runtime`;
 * 'custom' passes through the user-provided store, which imports with its own.
 */
export function resolveStore(params: {
	name: string
	storage: StorageParam
	/** The dialecte the store imports with; its default config gives the local store's record schema */
	runtime: ImportRuntime
	perf?: Perf
}): Store {
	const { name, storage, runtime, perf } = params
	if (storage.type === 'local') {
		const config = runtime.configs[runtime.defaultConfigKey]
		return new DexieStore(name, {
			recordSchema: config.database.recordSchema,
			perf,
			importRuntime: runtime,
		})
	}
	if (storage.type === 'inMemory') {
		return new InMemoryStore(name, { writable: storage.writable ?? true, importRuntime: runtime })
	}
	return storage.store
}
