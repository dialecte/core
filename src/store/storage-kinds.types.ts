import type { BUILT_IN_STORAGE_TYPES, STORAGE_KINDS_KEY } from './storage-kinds.constants'
import type { Perf } from '@/perf'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { StorageKinds, StorageParam } from '@/project/types'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/** The storage types core serves itself (`local`, `inMemory`, `custom`). */
export type BuiltInStorageType = (typeof BUILT_IN_STORAGE_TYPES)[number]

/** The storage types a kind can be registered for: every member of `StorageKinds` but core's built-ins. */
export type RegistrableStorageType = Exclude<keyof StorageKinds, BuiltInStorageType>

/** The dialecte a test project's store holds, as a storage kind receives it: its id, its configs, how its hooks are made. */
export type StorageKindDialecte = {
	id: string
	configs: Readonly<Record<string, AnyDialecteConfig>>
	defaultConfigKey: string
	createHooks?: () => DialecteHooks<AnyDialecteConfig>
}

/** A storage kind: how a project of one `storage.type` gets its store. */
export type StorageKind<GenericType extends string = string> = {
	/** What registered the kind and its version: a second registration of the same type is told apart by it. */
	id: string
	/** The store of a project on this kind. */
	storeOf(params: {
		name: string
		storage: Extract<StorageParam, { type: GenericType }>
		runtime: StoreRuntime
		dialecteId?: string
		perf?: Perf
	}): Store
	/** The store a test project opens on, in this realm; without it a test project opens on `storage` as it is. */
	testStoreOf?(params: {
		name: string
		storage: Extract<StorageParam, { type: GenericType }>
		dialecte: StorageKindDialecte
		perf?: boolean
	}): Promise<Store>
}

/** `globalThis` as it holds the registry of storage kinds, by type. */
export type StorageKindsHolder = { [STORAGE_KINDS_KEY]?: Map<string, StorageKind> }
