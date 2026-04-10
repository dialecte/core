import { Document } from '@/document'
import { mergeExtensions } from '@/helpers'
import { DexieStore } from '@/store'

import type { StorageOptions } from '@/store'
import type { AnyDialecteConfig, ExtensionModules } from '@/types'

export function openDialecteDocument<
	GenericConfig extends AnyDialecteConfig,
	BaseExtensions extends ExtensionModules = Record<never, never>,
	CustomExtensions extends ExtensionModules = Record<never, never>,
>(params: {
	config: GenericConfig
	storage: StorageOptions
	extensions?: { base?: BaseExtensions; custom?: CustomExtensions }
}) {
	const { config, storage, extensions } = params
	const merged = mergeExtensions({ base: extensions?.base, custom: extensions?.custom })
	if (storage.type === 'local') {
		return new Document(new DexieStore(storage.databaseName, config), config, merged)
	} else {
		return new Document(storage.store, config, merged)
	}
}
