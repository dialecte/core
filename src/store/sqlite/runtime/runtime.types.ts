import type { Heartbeat, ServedClient, StoreEvents } from '../../engine/host/host.types'
import type { SqliteEngine, SqliteEngineOptions } from '../engine/engine.types'
import type { SAHPoolUtil } from '@sqlite.org/sqlite-wasm'

/** What a SQLite engine opens with besides what every engine is told (`EngineOpenParams.settings`). */
export type SqliteEngineSettings = {
	/** The consumer's one SQLite wasm file. */
	wasmUrl: string
	options?: Partial<SqliteEngineOptions>
	/** How many SQLite steps between two of its progress handler's calls (`PROGRESS_BEAT_OPS` when absent). */
	progressBeatOps?: number
}

/** An engine worker's state: the project it serves, its pool, its lock, the engine, the client ports. */
export type EngineRuntimeState = {
	project: string | undefined
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

/** The project's lock, held: release it once the engine no longer touches the files. */
export type HeldEngineLock = {
	release: () => void
}

/** A file of the private file system as a dedicated worker reaches it (the page's types lack this member). */
export type SyncAccessFileHandle = FileSystemFileHandle & {
	createSyncAccessHandle: () => Promise<{ close: () => void }>
}
