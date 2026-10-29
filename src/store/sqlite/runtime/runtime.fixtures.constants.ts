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
