import { SQLITE_STORAGE_KEY } from './sqlite-storage.constants'

import { throwDialecteError } from '@/errors'

import type { SqliteStorage, SqliteStorageHolder } from './sqlite-storage.types'

/**
 * Register the `sqlite` storage kind for every copy of the library of the same storage version in this realm (what
 * importing `@dialecte/core/sqlite` does; `undefined`: none, a test's case). Answers the restore of the one
 * registered before.
 */
export function registerSqliteStorage(params: { storage: SqliteStorage | undefined }): () => void {
	const holder = globalThis as SqliteStorageHolder
	const before = holder[SQLITE_STORAGE_KEY]
	holder[SQLITE_STORAGE_KEY] = params.storage
	return function restoreSqliteStorage() {
		holder[SQLITE_STORAGE_KEY] = before
	}
}

/**
 * The `sqlite` storage kind registered; none - the app never imported `@dialecte/core/sqlite`, or imported it from a
 * copy of the library of another storage version - refused `PROJECT_SQLITE_NOT_IMPORTED` for `project`.
 */
export function registeredSqliteStorage(params: { project: string }): SqliteStorage {
	const storage = (globalThis as SqliteStorageHolder)[SQLITE_STORAGE_KEY]
	if (!storage) {
		throwDialecteError('PROJECT_SQLITE_NOT_IMPORTED', {
			detail: `Project "${params.project}" asks for SQLite storage, but '@dialecte/core/sqlite' was never imported in this realm: add \`import '@dialecte/core/sqlite'\` to the app's entry (a test runner's setup file for a test on it). Imported already? Then it came from another copy of @dialecte/core whose SQLite storage is of another version than the one opening the project (a dialecte bringing its own core): align the core versions`,
			meta: { project: params.project },
		})
	}
	return storage
}
