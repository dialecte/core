import type { SQLITE_ERRORS } from './sqlite-errors.constants'
import type { DialecteErrorKey } from '@/errors'

/** The keys of the errors the SQLite side declares (`SQLITE_ERRORS`). */
export type SqliteErrorKey = keyof typeof SQLITE_ERRORS

/** A key the SQLite side raises: one of core's catalogue, or one it declares itself. */
export type SqliteRaisedErrorKey = DialecteErrorKey | SqliteErrorKey
