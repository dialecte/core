/** One engine's attempt to open its project (the engine lock, then its own setup: SQLite probes and installs its pool). */
export const ENGINE_OPEN_BUDGET_MS = 10_000

/** How long a realm waits for its engine to close before it ends the worker anyway. */
export const ENGINE_CLOSE_BUDGET_MS = 2_000

/**
 * A client takes its engine for lost after this long with no message while a call waits: the engine
 * beats every second while it works (inside its longest steps too), and says `busy` before dialecte
 * code that may run longer.
 */
export const ENGINE_HEARTBEAT_TIMEOUT_MS = 10_000
