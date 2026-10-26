import type { DialecteErrorKey } from '@/errors'
import type { Store } from '@/store/store.types'
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** The page cache an import holds, sized on the device's memory: `clamp(gib * mibPerGiB, floorMiB, ceilingMiB)`. */
export type ImportCacheRule = {
	mibPerGiB: number
	floorMiB: number
	ceilingMiB: number
}

/** What an engine may be told at start; a field left out takes its default. */
export type SqliteEngineOptions = {
	/** The page cache outside imports, in MiB. */
	steadyCacheMiB: number
	/** The page cache while an import runs. */
	importCache: ImportCacheRule
}

export type OpenSqliteEngineParams = {
	sqlite3: Sqlite3Static
	/** The project's database, open: the engine is its only user from now on. */
	db: Database
	/** The dialecte the project belongs to, kept in a new file. */
	dialecteId: string
	options?: Partial<SqliteEngineOptions>
}

/** The port members an engine serves, with the port's own signatures. */
export type SqliteEngineMember =
	| 'registerDocument'
	| 'getDocument'
	| 'getDocuments'
	| 'updateDocument'
	| 'removeDocument'
	| 'get'
	| 'getByDocumentId'
	| 'count'
	| 'getByTagNameInDocument'
	| 'getMany'
	| 'bulkWrite'
	| 'getWriteOutcome'

/** The store port as an engine serves it. */
export type SqliteEngineApi = Pick<Store, SqliteEngineMember>

/** One project's database behind the store port: the single writer of its file. */
export type SqliteEngine = SqliteEngineApi & {
	/** Close the database; the engine serves nothing after. */
	close: () => void
}

/** Records encoded as rows of a document table: JSON arrays of up to `ROWS_PER_BIND` rows each. */
export type EncodedRows = {
	payloads: string[]
}

/** The store errors an engine throws a failure of SQLite as, one per kind of operation. */
export type StoreFailureKey = Extract<
	DialecteErrorKey,
	| 'STORE_CONNECTION_FAILED'
	| 'STORE_READ_FAILED'
	| 'STORE_COMMIT_FAILED'
	| 'STORE_BULK_ADD_FAILED'
	| 'STORE_BULK_UPDATE_FAILED'
	| 'STORE_DELETE_FAILED'
>
