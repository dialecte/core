/**
 * The version of what copies of the library share through the registry of storage kinds: the `StorageKind` shape and
 * the Store contract (a copy's Project calls a store another copy's kind built). Bumped with any change of either, so
 * a copy of another version finds no kind (`PROJECT_STORAGE_NOT_REGISTERED`) instead of a store it cannot use:
 * `shared-shapes.test.ts` fails until it is; the shape is recorded per version in
 * `__shapes__/storage-kinds-v<version>.txt`, written at the first local run of a new version.
 */
export const STORAGE_KINDS_VERSION = 1

/**
 * Where the storage kinds are registered: on `globalThis`, so every copy of the library of the same version the page
 * loads (a dialecte's own copy, a pre-bundled test entry) finds the kinds the app's imports registered.
 */
export const STORAGE_KINDS_KEY = Symbol.for(
	`@dialecte/core/storage-kinds/v${STORAGE_KINDS_VERSION}`,
)

/** The storage types core serves itself: no kind is registered for them, and none may take their place. */
export const BUILT_IN_STORAGE_TYPES = ['local', 'inMemory', 'custom'] as const
