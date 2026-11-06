import type { Heartbeat, ServedClient, StoreEvents } from '../../engine/host/host.types'
import type { SqliteEngine, SqliteEngineOptions } from '../engine/engine.types'
import type { SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** What a SQLite engine opens with besides what every engine is told (`EngineOpenParams.settings`). */
export type SqliteEngineSettings = {
	/** The consumer's one SQLite wasm file. */
	wasmUrl: string
	options?: Partial<SqliteEngineOptions>
	/** How many SQLite steps between two of its progress handler's calls (`PROGRESS_BEAT_OPS` when absent). */
	progressBeatOps?: number
}

/** An engine worker's state: the project it serves and its dialecte, its pool, its lock, the engine, the client ports. */
export type EngineRuntimeState = {
	project: string | undefined
	/** The dialecte of `project`: set and cleared with it, the same name under another dialecte being another project. */
	dialecteId: string | undefined
	pool: SAHPoolUtil | undefined
	/** Releases the engine lock (held from the open until `close` or `destroy`). */
	releaseLock: (() => void) | undefined
	engine: SqliteEngine | undefined
	/** The project's channel, open while the engine is. */
	events: StoreEvents | undefined
	/** The engine's sign of life on the client ports, while it is open. */
	heartbeat: Heartbeat | undefined
	clients: Map<string, ServedClient>
}

/** What the pool's install is given: sqlite-wasm's options, with the one its types leave out. */
export type PoolInstallOptions = Parameters<Sqlite3Static['installOpfsSAHPoolVfs']>[0] & {
	/** An install that failed before in this worker tried again, not its failure answered again. */
	forceReinitIfPreviouslyFailed?: boolean
}

/** The project's lock, held: release it once the engine no longer touches the files. */
export type HeldEngineLock = {
	release: () => void
}

/** A file of the private file system as a dedicated worker reaches it (the page's types lack this member). */
export type SyncAccessFileHandle = FileSystemFileHandle & {
	createSyncAccessHandle: () => Promise<PoolFileAccess>
}

/** The synchronous access a worker has to a pool file, as far as the runtime uses it. */
export type PoolFileAccess = {
	close: () => void
	getSize: () => number
	read: (buffer: Uint8Array, options: { at: number }) => number
}

/** A pool file as the probe read it: its size, and its first bytes (its header's path, flags and digest). */
export type PoolFileHead = { size: number; header: Uint8Array }

/**
 * What an existing pool holds: the project's database, nothing but headers (it never held pages), or data with no
 * database (the database's header damaged).
 */
export type PoolContents = 'database' | 'blank' | 'lost'
