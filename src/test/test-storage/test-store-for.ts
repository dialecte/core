import { testStoreProviderOf } from './test-store-providers'

import { isBuiltInStorageType, registeredStorageKind } from '@/store/storage-kinds'

import type { TestStoreDialecte } from './test-storage.types'
import type { StorageParam } from '@/project'
import type { StorageKindDialecte } from '@/store/storage-kinds.types'
import type { AnyDialecteConfig } from '@/types'

/**
 * The storage a test project opens on, from its kind: core's own kinds (`local`, `inMemory`, `custom`) as they are;
 * another type, the store its registered kind's `testStoreOf` answers in this realm (a kind that runs its store
 * elsewhere runs it here, as the test helpers know the dialecte, not where the app serves it), else the one the test
 * entry provides for that type (`testStoreProviderOf`), or the storage as it is when neither has one. A kind exists
 * once the entry that registers it is imported (the runner's setup file), as for an app: otherwise refused
 * `PROJECT_STORAGE_NOT_REGISTERED`.
 */
export async function testStoreFor<GenericConfig extends AnyDialecteConfig>(params: {
	storage: StorageParam
	/** The test project's name. */
	name: string
	dialecte: TestStoreDialecte<GenericConfig>
	/** Measure the import's and the export's stages (`dev.perf`). */
	perf?: boolean
}): Promise<StorageParam> {
	const { storage, name, dialecte, perf } = params
	if (isBuiltInStorageType({ type: storage.type })) return storage
	const kind = registeredStorageKind({ project: name, type: storage.type })
	const testStoreOf = kind.testStoreOf ?? testStoreProviderOf({ type: storage.type })
	if (!testStoreOf) return storage
	const store = await testStoreOf({
		name,
		storage,
		dialecte: kindDialecteOf({ dialecte }),
		perf,
	})
	return { type: 'custom', store }
}

/** The dialecte as a kind receives it: its id, configs and hooks, erased to the config-agnostic shape at this one boundary. */
function kindDialecteOf<GenericConfig extends AnyDialecteConfig>(params: {
	dialecte: TestStoreDialecte<GenericConfig>
}): StorageKindDialecte {
	const { id, configs, defaultConfigKey, createHooks } = params.dialecte
	return {
		id,
		configs,
		defaultConfigKey,
		createHooks: createHooks as StorageKindDialecte['createHooks'],
	}
}
