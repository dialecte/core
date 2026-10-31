import { createClosingConnections } from '../closing-connections'
import { projectKeyOf } from '../engine/project-key'
import { createOpenConnections } from '../open-connections'

import type { InMemoryState } from './types'

/**
 * The state of every in-memory project of this realm, by its key (`inMemoryStateKeyOf`): each instance of a
 * project reads and writes the same one. One per copy of core loaded in the realm; nothing crosses realms. A
 * project's state lives until a store of it is destroyed.
 */
const STATES = new Map<string, InMemoryState>()

/** The instances of each project (its key) opened and not closed since: a destroy is refused while another one is. */
export const OPEN_IN_MEMORY_CONNECTIONS = createOpenConnections()

/** The instances of each project (its key) closed while operations of theirs run: a destroy lets those complete first. */
export const CLOSING_IN_MEMORY_CONNECTIONS = createClosingConnections()

/**
 * Where a project's in-memory state is kept: its dialecte and its name (`projectKeyOf`), or its name alone,
 * URI-encoded, when no dialecte is told - never a `/` in it, so it never reads as another dialecte's project.
 */
export function inMemoryStateKeyOf(params: { project: string; dialecteId?: string }): string {
	const { project, dialecteId } = params
	return dialecteId === undefined
		? encodeURIComponent(project)
		: projectKeyOf({ dialecteId, project })
}

/** The state of the project (its key), or none when nothing was written under it since it was last destroyed. */
export function findInMemoryState(params: { key: string }): InMemoryState | undefined {
	return STATES.get(params.key)
}

/** The state of the project (its key), started empty when there is none. */
export function ensureInMemoryState(params: { key: string }): InMemoryState {
	const { key } = params
	const held = STATES.get(key)
	if (held) return held
	const state = createInMemoryState()
	STATES.set(key, state)
	return state
}

/** Forget the state of the project (its key): every instance of it reads empty until something is written again. */
export function dropInMemoryState(params: { key: string }): void {
	STATES.delete(params.key)
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
