/** The engine beats at most this often while it works. */
export const ENGINE_HEARTBEAT_INTERVAL_MS = 1_000

/**
 * How long a closing engine lets its clients' calls answer before it closes their ports (under the
 * realm's own close budget).
 */
export const CLIENT_DRAIN_BUDGET_MS = 1_000

/**
 * An answer holding at least this many records is cloned onto the port in one step the engine cannot
 * beat inside (a whole large document read): its client is told the engine is busy around it.
 */
export const LARGE_ANSWER_RECORDS = 10_000
