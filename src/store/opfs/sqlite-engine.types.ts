import type { RecordSchema } from '../store.types'
import type { Store } from '../store.types'
import type { AnyDialecteConfig } from '@/types'
/**
 * Minimal typed facade over the `@sqlite.org/sqlite-wasm` oo1 surface we use, so
 * the engine stays `any`-free without depending on the package's large type tree.
 */

export type SqlValue = string | number | Uint8Array | null
export type SqlBindable = SqlValue

export interface SqliteStmt {
	bind(values: SqlBindable[]): SqliteStmt
	step(): boolean
	get(index: number): SqlValue
	reset(clearBindings?: boolean): SqliteStmt
	finalize(): void
}

export interface SqliteDb {
	exec(
		opts:
			| string
			| {
					sql: string
					bind?: SqlBindable[]
					rowMode?: string
					resultRows?: Record<string, SqlValue>[]
					callback?: (row: unknown) => void
			  },
	): unknown
	prepare(sql: string): SqliteStmt
	close(): void
}

/** Minimal facade over the sqlite3 module returned by `sqlite3InitModule()`. */
export interface Sqlite3Static {
	oo1: { DB: new (filename: string, flags?: string) => SqliteDb }
	installOpfsSAHPoolVfs(opts: { name: string; initialCapacity?: number }): Promise<SqliteSahPool>
}

/** The `opfs-sahpool` PoolUtil surface we use to open DBs and reclaim OPFS space. */
export interface SqliteSahPool {
	OpfsSAHPoolDb: new (filename: string) => SqliteDb
	/** Empties every file in the pool, freeing its OPFS bytes (used on project delete). */
	wipeFiles(): Promise<void>
	/** Unregisters the VFS and releases the pool's SyncAccessHandles. */
	removeVfs(): Promise<boolean>
}

/** How the engine opens its database. `memory` needs no Worker (used by tests). */
export type SqliteEngineMode = { kind: 'memory' } | { kind: 'opfs-sahpool'; projectName: string }

export type SqliteEngineOptions = {
	recordSchema: RecordSchema
}

/** SqliteStore construction options. `mode` defaults to the worker + OPFS path. */
export type SqliteStoreOptions = {
	recordSchema: RecordSchema
	/** `opfs-sahpool` runs the engine in a worker (production); `memory` runs it in-process (tests). */
	mode?: 'opfs-sahpool' | 'memory'
}

/**
 * The engine's callable surface — the `Store` methods (minus `name` /
 * `getDatabaseInstance`) plus `init`. Both the in-process `SqliteEngine` and the
 * Comlink worker proxy satisfy it, so `SqliteStore` can hold either without
 * Comlink's method-type gymnastics.
 */
export type SqliteEngineApi = Omit<
	Store,
	'name' | 'getDatabaseInstance' | 'open' | 'close' | 'beginImport' | 'finalizeImport'
> & {
	init(mode: SqliteEngineMode): Promise<void>
	close(): void | Promise<void>
	beginImport(documentId?: string): Promise<void>
	finalizeImport(documentId?: string): Promise<void>
	/** Parse + persist a file inside the engine's realm (worker), avoiding per-record clone. */
	importDocument(
		documentId: string,
		file: File,
		config: AnyDialecteConfig,
		useCustomRecordsIds?: boolean,
	): Promise<number>
}
