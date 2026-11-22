import { resolveStore } from '@/store/resolve-store'

import type { ReadModelStorage } from './read-model-harness.types'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

/**
 * A store of a project's name held directly, opened (unless `open` is false: a project given it as its `custom` storage
 * opens it): what a write around every project goes through, and what an uncached answer reads. Close it before the
 * project is destroyed.
 *
 * @intent write to a project's store without a project in a test, read a store directly
 */
export async function openRawStore(params: {
	storage: ReadModelStorage
	name: string
	dialecteId: string
	config: AnyDialecteConfig
	open?: boolean
}): Promise<Store> {
	const { storage, name, dialecteId, config, open = true } = params
	const resolved = await storage({ name, dialecteId })
	const store = resolveStore({
		name,
		dialecteId,
		storage: resolved,
		runtime: { configs: { default: config }, defaultConfigKey: 'default' },
	})
	if (open) await store.open()
	return store
}
