import { replaceSqliteStorage } from './sqlite-storage'
import { sqliteStoreOf } from './sqlite/sqlite-store-of'

import { onTestFinished } from 'vitest'

import type { SqliteEngineRegistration } from './sqlite-storage.types'

/** The `sqlite` storage kind registered for the case, as `@dialecte/core/sqlite` registers it; restored after it. */
export function withSqliteStorage(): void {
	onTestFinished(replaceSqliteStorage({ storage: { storeOf: sqliteStoreOf } }))
}

/** No `sqlite` storage kind for the case (an app that never imported `@dialecte/core/sqlite`); restored after it. */
export function withoutSqliteStorage(): void {
	onTestFinished(replaceSqliteStorage({ storage: undefined }))
}

/**
 * The `sqlite` storage kind registered for the case with the engine `registerSqliteEngine` would have left on it (id
 * and version of each dialecte, the worker's address), restored after the case. The kind is built here and not through
 * `registerSqliteEngine`, so a case about something else does not depend on the registration it does not test.
 */
export function withSqliteEngine(params: SqliteEngineRegistration): void {
	const { url, dialectes } = params
	const registered = dialectes.map(function idAndVersionOf({ id, version }) {
		return { id, version }
	})
	onTestFinished(
		replaceSqliteStorage({
			storage: { storeOf: sqliteStoreOf, engine: { url, dialectes: registered } },
		}),
	)
}
