/**
 * The version of what copies of the library share through the SQLite engine's registration: the
 * `SqliteEngineRegistration` it holds on `globalThis` (the `sqlite` storage kind's id carries no version). Bumped with any change of
 * the registration's shape, so a copy of another version finds no engine (`PROJECT_SQLITE_ENGINE_NOT_REGISTERED`)
 * instead of one it cannot read: `shared-shapes.test.ts` fails until it is; the shape (its members, and every type of
 * the package they reach) is recorded per version in `__shapes__/sqlite-storage-v<version>.txt`, written at the first
 * local run of a new version.
 */
export const SQLITE_STORAGE_VERSION = 3

/**
 * Where the app's registered SQLite engine is kept: on `globalThis`, so every copy of the library of the same SQLite
 * storage version the page loads (a dialecte's own copy, a pre-bundled test entry) finds the engine the app registered.
 * Its text names no `sqlite-engine`: that is the engine chunk's name, which no page chunk may hold.
 */
export const SQLITE_ENGINE_KEY = Symbol.for(
	`@dialecte/core/sqlite/engine-registration/v${SQLITE_STORAGE_VERSION}`,
)

/**
 * What registered the `sqlite` storage kind: every copy of `@dialecte/core` registers it under this one id, so a second
 * registration (the entry evaluated twice, another copy of any SQLite version) does nothing and the first copy's kind
 * serves them all. What must match between copies, the engine registration, is versioned on its own key
 * (`SQLITE_ENGINE_KEY`): a copy of another SQLite version is refused `PROJECT_SQLITE_ENGINE_NOT_REGISTERED` at open,
 * never at import.
 */
export const SQLITE_STORAGE_KIND_ID = '@dialecte/core/sqlite'
