import { CONTRACT_OTHER_DIALECTE_ID } from '../../contract/store-contract.constants'

import { TEST_DIALECTE } from '@/test/test-dialecte'

/** The channel a runtime test orders its fixture engine workers on. */
export const RUNTIME_FIXTURE_CHANNEL = 'dialecte::runtime-fixture'

/** How long each call of SQLite's progress handler waits in the slow-statements fixture. */
export const SLOW_STATEMENT_STEP_MS = 200

/**
 * How long each record-index build and each table drop runs once a case orders `slow-ddl`: one opcode
 * of that length, inside which SQLite's progress handler is never called (no beat).
 */
export const SLOW_DDL_MS = 3_000

/** How late the slow-destroy fixture answers a `destroy`: past the realm's close budget, within its own. */
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
 * The open budget of a case whose worker is deaf to `destroy`: the realm counts it deaf after this and
 * the close budget.
 */
export const DEAF_DESTROY_BUDGET_MS = 1_500

/**
 * How long a case waits on a worker that never answers its open (the realm's open window) or a client's
 * adoption (its heartbeat timeout) before the realm gives it up.
 */
export const SILENT_ENGINE_WAIT_MS = 1_000

/** The dialecte every fixture engine serves (core's test dialecte), as a realm names it to its engine. */
export const FIXTURE_DIALECTE = {
	dialecteId: TEST_DIALECTE.id,
	dialecteVersion: TEST_DIALECTE.version,
} as const

/** The dialecte the `other-dialecte` fixture engine serves: another id (the contract's, whose legs run it), the same version. */
export const OTHER_FIXTURE_DIALECTE = {
	dialecteId: CONTRACT_OTHER_DIALECTE_ID,
	dialecteVersion: TEST_DIALECTE.version,
} as const

/** How long a change may take to reach another connection on a loaded machine (a port message, a worker's turn). */
export const CHANGE_TOLD_WITHIN_MS = 5_000

/**
 * The heartbeat timeout of a case an engine must stay alive through: below every span those cases run (3 s or more),
 * so only its beats keep a call alive, and wide enough that a beat a loaded machine posts late is not taken for a loss.
 */
export const KEPT_ALIVE_TIMEOUT_MS = 2_500
