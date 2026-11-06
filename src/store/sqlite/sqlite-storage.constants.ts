/**
 * The version of what copies of the library share through the registration: the `SqliteStorage` it holds and the
 * Store contract of the stores it builds (a copy's Project calls another copy's store). Bumped with any change of
 * either, so a copy of another version finds no kind (`PROJECT_SQLITE_NOT_IMPORTED`) instead of a store it cannot use:
 * `shared-shapes.test.ts` fails until it is: the shape (their members, and every type of the package they reach) is
 * recorded per version in `__shapes__/sqlite-storage-v<version>.txt`, written at the first local run of a new version.
 */
export const SQLITE_STORAGE_VERSION = 2

/**
 * Where the `sqlite` storage kind is registered: on `globalThis`, so every copy of the library of the same storage
 * version the page loads (a dialecte's own copy, a pre-bundled test entry) finds the kind the app's import registered.
 */
export const SQLITE_STORAGE_KEY = Symbol.for(
	`@dialecte/core/sqlite-storage/v${SQLITE_STORAGE_VERSION}`,
)
