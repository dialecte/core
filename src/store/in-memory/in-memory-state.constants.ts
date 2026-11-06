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
