import { createClosingConnections } from '../closing-connections'
import { createOpenConnections } from '../open-connections'

import type { InMemoryState } from './types'

/**
 * The state of every in-memory store name of this realm: each instance of a name reads and writes the
 * same one, as every connection to an IndexedDB database of a name does. One per copy of core loaded
 * in the realm; nothing crosses realms. A name's state lives until a store of that name is destroyed.
 */
const STATES = new Map<string, InMemoryState>()

/** The instances of each name opened and not closed since: a destroy is refused while another one is. */
export const OPEN_IN_MEMORY_CONNECTIONS = createOpenConnections()

/** The instances of each name closed while operations of theirs run: a destroy lets those complete first. */
export const CLOSING_IN_MEMORY_CONNECTIONS = createClosingConnections()

/** The state of the name, or none when nothing was written under it since it was last destroyed. */
export function findInMemoryState(params: { name: string }): InMemoryState | undefined {
	return STATES.get(params.name)
}

/** The state of the name, started empty when there is none. */
export function ensureInMemoryState(params: { name: string }): InMemoryState {
	const { name } = params
	const held = STATES.get(name)
	if (held) return held
	const state = createInMemoryState()
	STATES.set(name, state)
	return state
}

/** Forget the state of the name: every instance of it reads empty until something is written again. */
export function dropInMemoryState(params: { name: string }): void {
	STATES.delete(params.name)
}

export function createInMemoryState(): InMemoryState {
	return {
		documents: new Map(),
		records: new Map(),
		changelog: new Map(),
		heads: new Map(),
		discardedCommits: new Map(),
		blobs: new Map(),
		blobData: new Map(),
		runningImports: new Set(),
		versions: new Map(),
	}
}

/** A write landed on the document: its version moves on (in the write's synchronous section, so an export reading it sees the write). */
export function bumpVersion(params: { state: InMemoryState; documentId: string }): void {
	const { state, documentId } = params
	state.versions.set(documentId, (state.versions.get(documentId) ?? 0) + 1)
}
