import type { EngineLostReason } from './client.types'

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

/** What the work asked of an engine the realm ends answers once its budget passed with no answer: the engine is deaf. */
export const UNANSWERED = 'unanswered'

/** What a call refused `STORE_ENGINE_LOST` says, for each reason its engine was lost. */
export const ENGINE_LOST_DETAILS: Record<EngineLostReason, string> = {
	'host-gone': 'The project engine ended with the view that hosted it',
	'no-heartbeat': 'The project engine sent nothing for too long while a call waited',
	'realm-dropped':
		'This view was dropped with the page that bound it: bound again, it reaches the engine',
}
