import type { ConnectionLostReason } from './client.types'

/** One engine's attempt to open its project (the engine lock, then its own setup: SQLite probes and installs its pool). */
export const ENGINE_OPEN_BUDGET_MS = 10_000

/**
 * The longest a realm waits for its engine's answer to an open, the hub's client as a realm running the
 * engine itself: a slow worker start (seconds under load), the engine's own budget for its lock and its
 * pool, then its database opened and the imports a dead view left removed. An engine silent past it is
 * ended, the open refused `PROJECT_ENGINE_UNAVAILABLE`.
 */
export const ENGINE_OPEN_WINDOW_MS = 30_000

/** How long a realm waits for its engine to close before it ends the worker anyway. */
export const ENGINE_CLOSE_BUDGET_MS = 2_000

/**
 * How long an engine a listening connection followed (no call of its own) must run before its end is followed too;
 * doubled at each such follow up to `ENGINE_FOLLOW_REARM_MAX_MS`, back to this at a call of its own: an engine that
 * does not last is not started again and again for a listener.
 */
export const ENGINE_FOLLOW_REARM_FIRST_MS = 1_000
export const ENGINE_FOLLOW_REARM_MAX_MS = 30_000

/**
 * A client takes its engine for lost after this long with no message while a call waits: the engine
 * beats every second while it works (inside its longest steps too), and says `busy` before dialecte
 * code that may run longer.
 */
export const ENGINE_HEARTBEAT_TIMEOUT_MS = 10_000

/** What the work asked of an engine the realm ends answers once its budget passed with no answer: the engine is deaf. */
export const UNANSWERED = 'unanswered'

/** What a call refused `STORE_CONNECTION_LOST` says, for each reason its engine was lost. */
export const CONNECTION_LOST_DETAILS: Record<ConnectionLostReason, string> = {
	'host-gone': 'The project engine ended with the view that hosted it',
	'no-heartbeat': 'The project engine sent nothing for too long while a call waited',
	'realm-dropped':
		'This view was dropped with the page that bound it: bound again, it reaches the engine',
}
