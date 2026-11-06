import { replaceSqliteEngine } from './sqlite-engine-registration'
import { SQLITE_STORAGE_KIND } from './sqlite-storage-kind'

import { onTestFinished } from 'vitest'

import { replaceStorageKind } from '@/store/storage-kinds'

import type { SqliteEngineRegistration } from './sqlite-storage.types'

/** The `sqlite` storage kind registered for the case, as `@dialecte/core/sqlite` registers it; restored after it. */
export function withSqliteStorage(): void {
	onTestFinished(replaceStorageKind({ type: 'sqlite', kind: SQLITE_STORAGE_KIND }))
}

/** No `sqlite` storage kind for the case (an app that never imported `@dialecte/core/sqlite`); restored after it. */
export function withoutSqliteStorage(): void {
	onTestFinished(replaceStorageKind({ type: 'sqlite', kind: undefined }))
}

/**
 * The `sqlite` storage kind registered for the case with the engine `registerSqliteEngine` would have left (id and
 * version of each dialecte, the worker's address), both restored after the case. The engine is put here and not
 * through `registerSqliteEngine`, so a case about something else does not depend on the registration it does not test.
 */
export function withSqliteEngine(params: SqliteEngineRegistration): void {
	const { url, dialectes } = params
	const registered = dialectes.map(function idAndVersionOf({ id, version }) {
		return { id, version }
	})
	withSqliteStorage()
	onTestFinished(replaceSqliteEngine({ engine: { url, dialectes: registered } }))
}
