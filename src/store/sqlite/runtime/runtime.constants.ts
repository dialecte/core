/** The OPFS directory holding every project's pool, one directory each. */
export const POOL_ROOT_DIRECTORY = 'dialecte'

/** The name the pool's VFS is registered under in its worker (one project per engine worker). */
export const POOL_VFS_NAME = 'dialecte-pool'

/** The project's database inside its pool. */
export const POOL_FILE = '/project.sqlite3'

/** The files a new pool is given: the database, its journal and the temporary files SQLite opens. */
export const POOL_CAPACITY = 6

/**
 * The oldest SQLite (`sqlite3.version.libVersionNumber`) whose sqlite-wasm keeps a pool's files when its install
 * fails (`preserveOnInitFailure`, 3.54.1-build1): an older one ignores the option and removes the whole pool.
 */
export const SAFE_POOL_SQLITE_VERSION = 3_054_001

/** The subdirectory where sqlite-wasm keeps a pool's files. */
export const OPAQUE_DIRECTORY = '.opaque'

/** Waits between two probes of a pool file still held by an engine that ended (the last one repeats). */
export const PROBE_BACKOFF_MS = [25, 50, 100, 200, 400] as const

/** The space a new pool needs free: its files' headers and the database's first pages, with room to spare. */
export const NEW_POOL_FREE_BYTES = 1024 * 1024

/**
 * SQLite's progress handler runs every this many virtual-machine steps of a statement - its count
 * starts again with each statement, so it must be small enough that the engine's chunked work (1,000
 * ids or rows a statement: an import's after-writes, a commit, a large delete) beats too, not only one
 * long statement; the handler only reads the clock until a beat is due.
 */
export const PROGRESS_BEAT_OPS = 10_000

/**
 * A write the file system failed while the origin has less than this left failed for want of space:
 * the quota refuses a write larger than what is left - the engine's own writes are pages and windows of
 * a few MiB, but a file's capacity may grow by a larger step - so the bound leaves room to spare.
 */
export const OUT_OF_SPACE_BYTES = 64 * 1024 * 1024
