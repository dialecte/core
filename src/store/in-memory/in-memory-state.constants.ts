import { createClosingConnections } from '../closing-connections'
import { createOpenConnections } from '../open-connections'

import type { InMemoryListener, InMemoryState } from './types'

/**
 * The state of every in-memory project of this realm, by its key (`inMemoryStateKeyOf`): each instance of a
 * project reads and writes the same one. One per copy of core loaded in the realm; nothing crosses realms. A
 * project's state lives until a store of it is destroyed.
 */
export const STATES = new Map<string, InMemoryState>()

/** The instances of each project (its key) opened and not closed since: a destroy is refused while another one is. */
export const OPEN_IN_MEMORY_CONNECTIONS = createOpenConnections()

/** The instances of each project (its key) closed while operations of theirs run: a destroy lets those complete first. */
export const CLOSING_IN_MEMORY_CONNECTIONS = createClosingConnections()

/** The instances of each project (its key) listening to its changes: each change told to every one. */
export const LISTENERS = new Map<string, Set<InMemoryListener>>()

/**
 * How many in-memory states this copy of core made: each state's engine id is the next count. No random draw: an id
 * spends nothing a seeded id sequence counts on.
 */
export const STATES_MADE = { count: 0 }

/** The engine id of the state made `<count>`th: `<prefix><count>`. */
export const IN_MEMORY_ENGINE_PREFIX = 'in-memory#'
