import { replaceSqliteStorage } from './sqlite-storage'
import { sqliteStoreOf } from './sqlite/sqlite-store-of'

import { onTestFinished } from 'vitest'

/** The `sqlite` storage kind registered for the case, as `@dialecte/core/sqlite` registers it; restored after it. */
export function withSqliteStorage(): void {
	onTestFinished(replaceSqliteStorage({ storage: { storeOf: sqliteStoreOf } }))
}

/** No `sqlite` storage kind for the case (an app that never imported `@dialecte/core/sqlite`); restored after it. */
export function withoutSqliteStorage(): void {
	onTestFinished(replaceSqliteStorage({ storage: undefined }))
}
