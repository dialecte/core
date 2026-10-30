/** The wire protocol a realm and the hub speak; a realm speaking another one is refused. */
export const HUB_PROTOCOL_VERSION = 1

/** An engine left without client is told to close after this long; an open meanwhile keeps it. */
export const ENGINE_IDLE_CLOSE_MS = 5_000

/**
 * An engine is started again (a busy retry, a new host) only with at least this much of the open
 * window left; with less, the waiting clients get their answer.
 */
export const ENGINE_OPEN_MIN_BUDGET_MS = 1_000

/**
 * The longest a client waits for the hub's answer to an open: a slow worker start (seconds under
 * load) plus one whole engine attempt, with room to retry an engine that answers busy early.
 */
export const HUB_OPEN_BUDGET_MS = 30_000

/** The prefix of a realm's Web Lock, held for the realm's life: the hub's grant of it means the realm is gone. */
export const REALM_LOCK_PREFIX = 'dialecte:realm:'
