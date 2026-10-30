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

/** Where a pool file header's digest starts: after its path (512 bytes) and its flags (4). */
const POOL_HEADER_DIGEST_OFFSET = 516
/** The digest's length: two 32-bit words. */
const POOL_HEADER_DIGEST_BYTES = 8

/**
 * sqlite-wasm's pool file header (opfs-sahpool; frozen there: a change orphans every pool): the file's path (512
 * bytes, NUL-ended), its SQLite open flags (4, big-endian, at `flagsOffset`) and their digest (two native 32-bit
 * words), the file's data from `bytes` on. `headBytes` is what the probe reads of each file: up to the digest's end.
 */
export const POOL_FILE_HEADER = {
	bytes: 4096,
	flagsOffset: 512,
	digestOffset: POOL_HEADER_DIGEST_OFFSET,
	digestBytes: POOL_HEADER_DIGEST_BYTES,
	headBytes: POOL_HEADER_DIGEST_OFFSET + POOL_HEADER_DIGEST_BYTES,
} as const

/** The SQLite open flags (sqlite3.h) sqlite-wasm's header check reads; `digestV2` marks a header with a digest. */
export const POOL_HEADER_FLAGS = {
	deleteOnClose: 0x8,
	digestV2: 0x80,
	/** main database, main journal, super-journal, WAL: the files sqlite-wasm keeps */
	persistentTypes: 0x100 | 0x800 | 0x4000 | 0x80000,
} as const

/** The seeds and multipliers of sqlite-wasm's header digest (two 32-bit multiplicative hashes). */
export const POOL_HEADER_DIGEST = {
	seeds: [0xdeadbeef, 0x41c6ce57],
	multipliers: [2654435761, 104729],
} as const

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
