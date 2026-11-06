import { SQLITE_ERRORS } from './sqlite-errors.constants'

import type { SqliteErrorKey, SqliteRaisedErrorKey } from './sqlite-errors.types'
import type { DialecteErrorDefinition, DialecteErrorKey } from '@/errors'

/**
 * What `createDialecteError` takes for a key the SQLite side raises, held as data (a refusal the hub's router decides):
 * the SQLite catalogue's entry for one of its keys, the key itself for one of core's.
 */
export function sqliteErrorEntryOf(params: {
	key: SqliteRaisedErrorKey
}): DialecteErrorKey | DialecteErrorDefinition {
	const { key } = params
	return isSqliteErrorKey(key) ? SQLITE_ERRORS[key] : key
}

/** Whether the key is one the SQLite side declares, not one of core's catalogue (a guard on the key itself). */
function isSqliteErrorKey(key: SqliteRaisedErrorKey): key is SqliteErrorKey {
	return Object.hasOwn(SQLITE_ERRORS, key)
}
