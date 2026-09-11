import { DexieStore, InMemoryStore } from '@/store'
import { SqliteStore } from '@/store/opfs/sqlite-store'

import type { StorageParam } from '../project/types'
import type { DexieStoreOptions } from './local'
import type { Perf } from '@/perf'
import type { Store } from '@/store'
import type { AnyDialecteConfig } from '@/types'

/**
 * Resolve the Store instance from open params.
 * 'local' creates a DexieStore; 'inMemory' creates an InMemoryStore;
 * 'opfs' creates a worker-backed SqliteStore; 'custom' passes through.
 */
export function resolveStore<GenericConfig extends AnyDialecteConfig>(
	name: string,
	storage: StorageParam,
	config: GenericConfig,
	perf?: Perf,
): Store {
	if (storage.type === 'local') {
		const options: DexieStoreOptions = { recordSchema: config.database.recordSchema, perf }
		return new DexieStore(name, options)
	}
	if (storage.type === 'inMemory') {
		return new InMemoryStore(name, { writable: storage.writable ?? true })
	}
	if (storage.type === 'opfs') {
		return new SqliteStore(name, {
			recordSchema: config.database.recordSchema,
			definitionSpecifier: storage.definitionSpecifier,
		})
	}
	return storage.store
}
