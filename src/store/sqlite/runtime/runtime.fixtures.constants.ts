/** The channel a runtime test orders its fixture engine workers on. */
export const RUNTIME_FIXTURE_CHANNEL = 'dialecte::runtime-fixture'

/** How long each call of SQLite's progress handler waits in the slow-statements fixture. */
export const SLOW_STATEMENT_STEP_MS = 200

/** A slice of the yielding afterImport the liveness fixture runs, between two message turns. */
export const YIELDING_SLICE_MS = 200

/**
 * How far a span moved from a worker's clock onto the page's may land outside the page's own readings:
 * each realm coarsens its \`timeOrigin\` and \`performance.now()\` on its own (about a millisecond seen).
 */
export const CROSS_REALM_CLOCK_SLACK_MS = 5
