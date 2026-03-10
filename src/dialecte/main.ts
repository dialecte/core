import { Document } from '@/document'
import { DexieStore } from '@/store'

import type { StorageOptions } from '@/store'
import type { AnyDialecteConfig } from '@/types'

export function openDialecteDocument<GenericConfig extends AnyDialecteConfig>(params: {
	config: GenericConfig
	storage: StorageOptions
}): Document<GenericConfig> {
	const { config, storage } = params
	if (storage.type === 'local') {
		return new Document(new DexieStore(storage.databaseName, config), config)
	} else {
		return new Document(storage.store, config)
	}
}
