/** How long past its idle grace and close budget a hub's engine may take to let its lock go before a case gives up. */
export const ENGINE_END_SLACK_MS = 3_000

/** A wait just past an engine's idle grace: the grace has run out by then. */
export const PAST_THE_GRACE_MS = 500

/** How many times a case asks a destroy that another realm's leave, still on its way, may refuse. */
export const DESTROY_ASKS = 20

/** Between two such asks. */
export const DESTROY_ASK_INTERVAL_MS = 100

/** How long one ask may take before the case gives up on it (well inside the case's own timeout). */
export const DESTROY_ASK_BUDGET_MS = 15_000
