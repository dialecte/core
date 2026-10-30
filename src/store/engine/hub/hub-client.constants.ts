import { HUB_PROTOCOL_VERSION } from './hub.constants'

/** Where a realm keeps its hub connection: shared by every copy of the library speaking this protocol. */
export const HUB_REGISTRY_KEY = Symbol.for(`@dialecte/core/hub/v${HUB_PROTOCOL_VERSION}`)

/**
 * How long a realm waits for the hub's welcome once it said hello: a hub that does not answer (its
 * script failed to load, or was blocked; a parent that unbound the port meanwhile) fails the join
 * instead of keeping the realm waiting.
 */
export const HUB_WELCOME_BUDGET_MS = 10_000

/**
 * A page back from a freeze whose hub cannot be reached tries again after this long, the delay doubling
 * up to `HUB_REJOIN_MAX_DELAY_MS` (a hub restarting on a loaded machine, a deploy that moved its chunk).
 */
export const HUB_REJOIN_FIRST_DELAY_MS = 1_000

export const HUB_REJOIN_MAX_DELAY_MS = 30_000
