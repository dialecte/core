import { Document } from '@/document'
import { DexieStore } from '@/store'

import type { StorageOptions } from '@/store'
import type { AnyDialecteConfig, ExtensionsRegistry } from '@/types'

export function openDialecteDocument<
	GenericConfig extends AnyDialecteConfig,
	GenericExt extends ExtensionsRegistry = {},
>(params: {
	config: GenericConfig
	storage: StorageOptions
	extensions?: GenericExt
}): Document<GenericConfig, GenericExt> {
	const { config, storage, extensions } = params
	if (storage.type === 'local') {
		return new Document(new DexieStore(storage.databaseName, config), config, extensions)
	} else {
		return new Document(storage.store, config, extensions)
	}
}
