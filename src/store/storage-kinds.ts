import { BUILT_IN_STORAGE_TYPES, STORAGE_KINDS_KEY } from './storage-kinds.constants'

import { throwDialecteError } from '@/errors'

import type { RegistrableStorageType, StorageKind, StorageKindsHolder } from './storage-kinds.types'

/**
 * Register the store a storage type gets, for every copy of `@dialecte/core` of the same storage version in this
 * realm: a project opened on `{ type }` gets the store `kind.storeOf` builds, a test project the one
 * `kind.testStoreOf` answers (or the storage as it is, without it). The type is first declared by a module
 * augmentation (`declare module '@dialecte/core' { interface StorageKinds { <type>: { type: '<type>'; ... } } }`),
 * then registered once, by the entry that brings the kind (importing it is the app's opt-in). The first registration
 * of a type is kept: the same `kind.id` again does nothing (a module evaluated twice, another copy of the
 * package); another `id` is refused `STORE_KIND_TAKEN`, nothing replaced. Core's own types (`local`, `inMemory`,
 * `custom`) are refused `ASSERTION_FAILED`: core serves them, no kind takes their place.
 *
 * @intent add a storage kind to core, register a store a project opens on by its storage type, write a package that brings its own storage
 */
export function registerStorageKind<GenericType extends RegistrableStorageType>(params: {
	type: GenericType
	kind: StorageKind<GenericType>
}): void {
	const { type, kind } = params
	if (isBuiltInStorageType({ type })) {
		throwDialecteError('ASSERTION_FAILED', {
			detail: `Storage type "${type}" is one core serves itself (${BUILT_IN_STORAGE_TYPES.join(', ')}): no kind is registered for it`,
		})
	}
	const registry = realmRegistry()
	const registered = registry.get(type)
	if (!registered) {
		putKind({ registry, type, kind })
		return
	}
	if (registered.id === kind.id) return
	throwDialecteError('STORE_KIND_TAKEN', {
		detail: `Storage type "${type}" is registered already by ${registered.id}, not by ${kind.id}: the first registration in the realm is kept`,
		meta: { type, registered: registered.id, asked: kind.id },
	})
}

/**
 * A test's kind for its case (`undefined`: none, an app that never imported the entry registering it); answers the
 * restore, which puts back the kind before it, or none.
 *
 * @internal for tests
 */
export function replaceStorageKind<GenericType extends string>(params: {
	type: GenericType
	kind: StorageKind<GenericType> | undefined
}): () => void {
	const { type, kind } = params
	const registry = realmRegistry()
	const before = registry.get(type)
	putKind({ registry, type, kind })
	return function restoreStorageKind() {
		putKind({ registry, type, kind: before })
	}
}

/**
 * The kind registered for `type` in this realm, whichever copy of the library registered it; none - the app never
 * imported the entry that registers it, or a copy of another storage version did - refused
 * `PROJECT_STORAGE_NOT_REGISTERED` for `project`.
 *
 * @internal store selection when a project or a test project opens
 */
export function registeredStorageKind(params: { project: string; type: string }): StorageKind {
	const { project, type } = params
	const kind = (globalThis as StorageKindsHolder)[STORAGE_KINDS_KEY]?.get(type)
	if (!kind) {
		throwDialecteError('PROJECT_STORAGE_NOT_REGISTERED', {
			detail: `Project "${project}" asks for storage of type "${type}", but no kind is registered for it in this realm: import the entry that registers it once in the app's entry (a test runner's setup file for a test on it). Imported already? Then a copy of @dialecte/core of another storage version registered it (a package bringing its own core): align the core versions`,
			meta: { project, type },
		})
	}
	return kind
}

/** Whether `type` is one core serves itself (`local`, `inMemory`, `custom`), which no kind is registered for. */
export function isBuiltInStorageType(params: { type: string }): boolean {
	const builtIns: readonly string[] = BUILT_IN_STORAGE_TYPES
	return builtIns.includes(params.type)
}

/** The realm's registry, made on first use: one `Map` on `globalThis` for every copy of the same version. */
function realmRegistry(): Map<string, StorageKind> {
	const holder = globalThis as StorageKindsHolder
	holder[STORAGE_KINDS_KEY] ??= new Map()
	return holder[STORAGE_KINDS_KEY]
}

/** The realm's kind of `type` set to `kind`, or removed for none: each kind kept as the registry holds them all. */
function putKind<GenericType extends string>(params: {
	registry: Map<string, StorageKind>
	type: GenericType
	kind: StorageKind<GenericType> | undefined
}): void {
	const { registry, type, kind } = params
	// kept as given (its methods may read `this`), its type erased: the registry is read by type, so the kind it
	// answers for `type` is this one; the compiler cannot relate one type's kind to the erased one by itself
	if (kind) registry.set(type, kind as unknown as StorageKind)
	else registry.delete(type)
}
