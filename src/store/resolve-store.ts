import { DexieStore } from '@/store'

import type { StorageParam } from '../project/types'
import type { DexieStoreOptions } from './local'
import type { Store } from '@/store'
import type { AnyDialecteConfig } from '@/types'

/**
 * Resolve the Store instance from open params.
 * 'local' creates a DexieStore; 'custom' passes through the user-provided store.
 */
export function resolveStore<GenericConfig extends AnyDialecteConfig>(
	name: string,
	storage: StorageParam,
	config: GenericConfig,
): Store {
	if (storage.type === 'local') {
		const options: DexieStoreOptions = { recordSchema: config.database.recordSchema }
		return new DexieStore(name, options)
	}
	return storage.store
}
