import { Document } from '@/document'
import { mergeExtensions } from '@/helpers'
import { DexieStore } from '@/store'

import type { OpenParams } from './main.types'
import type { Store, StorageOptions } from '@/store'
import type { AnyDialecteConfig, ExtensionModules } from '@/types'

export function openDialecteDocument<
	GenericConfig extends AnyDialecteConfig,
	BaseExtensions extends ExtensionModules = Record<never, never>,
	CustomExtensions extends ExtensionModules = Record<never, never>,
>(params: OpenParams<GenericConfig, BaseExtensions, CustomExtensions>) {
	const { config, storage, extensions, hooks } = params
	const merged = mergeExtensions({ base: extensions?.base, custom: extensions?.custom })
	const store = resolveStore(storage, config)
	return new Document(store, config, merged, hooks)
}

export async function createDialecteDocument<
	GenericConfig extends AnyDialecteConfig,
	BaseExtensions extends ExtensionModules = Record<never, never>,
	CustomExtensions extends ExtensionModules = Record<never, never>,
>(params: OpenParams<GenericConfig, BaseExtensions, CustomExtensions>) {
	const { config, storage, extensions, hooks } = params
	const merged = mergeExtensions({ base: extensions?.base, custom: extensions?.custom })
	const store = resolveStore(storage, config)

	const rootDef = config.definition[config.rootElementName]
	const attributes = Object.entries(rootDef?.attributes.details ?? {})
		.filter(([, def]) => def.required)
		.map(([name, def]) => ({
			name,
			value: def.fixed ?? def.default ?? '',
			...(def.namespace ? { namespace: def.namespace } : {}),
		}))

	await store.commit({
		creates: [
			{
				id: crypto.randomUUID(),
				tagName: config.rootElementName,
				namespace: config.namespaces.default,
				attributes,
				value: '',
				parent: null,
				children: [],
			},
		],
		updates: [],
		deletes: [],
		onProgress: () => {},
	})

	return new Document(store, config, merged, hooks)
}

// ── Helper ───────────────────────────────────────────────────────────────────

function resolveStore<GenericConfig extends AnyDialecteConfig>(
	storage: StorageOptions,
	config: GenericConfig,
): Store {
	return storage.type === 'local' ? new DexieStore(storage.databaseName, config) : storage.store
}
