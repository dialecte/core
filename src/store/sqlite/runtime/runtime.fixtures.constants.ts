/** The channel a runtime test orders its fixture engine workers on. */
export const RUNTIME_FIXTURE_CHANNEL = 'dialecte::runtime-fixture'

/** How long each call of SQLite's progress handler waits in the slow-statements fixture. */
export const SLOW_STATEMENT_STEP_MS = 200

/**
 * How long each record-index build and each table drop runs once a case orders `slow-ddl`: one opcode
 * of that length, inside which SQLite's progress handler is never called (no beat).
 */
export const SLOW_DDL_MS = 3_000

/** How late the slow-destroy fixture answers a `destroy` once open: past the realm's close budget, within its own. */
export const SLOW_DESTROY_MS = 3_000

/** The statements `slow-ddl` makes long: a record table's index built, a table dropped. */
export const SLOW_DDL_PATTERN = /^\s*(CREATE (UNIQUE )?INDEX xel_|DROP TABLE )/i

/** A slice of the yielding afterImport the liveness fixture runs, between two message turns. */
export const YIELDING_SLICE_MS = 200

/**
 * How far a span moved from a worker's clock onto the page's may land outside the page's own readings:
 * each realm coarsens its `timeOrigin` and `performance.now()` on its own (about a millisecond seen).
 */
export const CROSS_REALM_CLOCK_SLACK_MS = 5

/**
 * How long a case spawning engine workers may run before it counts as hung: each worker loads SQLite
 * and opens its pool, seconds apiece on a loaded machine (a case of two workers took 15 s at a 1-minute
 * load of 15-20) - a timeout catches a hang, it never measures speed.
 */
export const ENGINE_WORKER_CASE_TIMEOUT_MS = 60_000

/**
 * How long a case waits for engine workers to queue on a project's engine lock: each loads SQLite before it asks for
 * the lock, seconds on a loaded machine - a bound for a hang, never a measure of speed.
 */
export const LOCK_QUEUE_TIMEOUT_MS = 15_000

/** The SQLite the `sqlite-3-53` fixture reports: 3.53.4, whose sqlite-wasm removes a pool when its install fails. */
export const UNSAFE_POOL_SQLITE = { libVersion: '3.53.4', libVersionNumber: 3_053_004 } as const

/**
 * How long the engines of a lock race wait for the project's lock and files: past the page's hold, and with the two
 * queue waits below the case's timeout - a reader still shut out at the end is refused by name
 * (`PROJECT_ENGINE_BUSY`), not cut by the timeout.
 */
export const LOCK_RACE_BUDGET_MS = 20_000

/**
 * What the install-failure fixtures refuse a pool file's second handle with, as `String(error)` reads it: a refusal
 * of this text came from the pool's install, not from the probe before it (`STORE_CONNECTION_FAILED`).
 */
export const INSTALL_REFUSAL = {
	name: 'InvalidStateError',
	message: 'The file could not be opened.',
	text: 'InvalidStateError: The file could not be opened.',
} as const

/** What the open-failure fixtures throw (an `Error` of this message): a refusal of it came from the fixture. */
export const OPEN_FAILURE = {
	hooks: 'a dialecte failing to make its hooks',
	database: 'the database could not be opened',
} as const

/**
 * How far past its budget a refused open may answer in a case: the realm's messages and one probe backoff step - a
 * case measuring that one budget covers the wait for the lock and the probe of the files together.
 */
export const ONE_BUDGET_SLACK_MS = 1_000

/**
 * The open budget of a case whose engine is deaf to `destroy` and needs no long lock wait: the realm
 * counts it deaf after this and the close budget.
 */
export const DEAF_DESTROY_BUDGET_MS = 1_500
