/** The engine beats at most this often while it works. */
export const ENGINE_HEARTBEAT_INTERVAL_MS = 1_000

/**
 * How long a closing engine lets its clients' calls answer before it closes their ports (under the
 * realm's own close budget).
 */
export const CLIENT_DRAIN_BUDGET_MS = 1_000
