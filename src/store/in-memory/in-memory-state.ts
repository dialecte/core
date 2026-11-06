import { projectKeyOf } from '../project-key'
import { LISTENERS, STATES } from './in-memory-state.constants'

import { changesOfProject, tellListener } from '@/utils/tell-listener'

import type { StoreNotice } from '../store.types'
import type { InMemoryChange, InMemoryListener, InMemoryState } from './types'
import type { ProjectChannelMessage } from '@/project/types'

/** `listener` of the project (its key) told its changes, as `connection`; answers the unsubscribe. */
export function listenToInMemoryProject(params: {
	key: string
	connection: object
	listener: (notice: StoreNotice) => void
}): () => void {
	const { key, connection, listener } = params
	const listening = LISTENERS.get(key) ?? new Set<InMemoryListener>()
	LISTENERS.set(key, listening)
	const entry: InMemoryListener = { connection, listener }
	listening.add(entry)
	return function stopListening() {
		listening.delete(entry)
		if (listening.size === 0 && LISTENERS.get(key) === listening) LISTENERS.delete(key)
	}
}

/** A change of the project (its key; `name`, as a failing listener's report names it) told to every instance listening, `own` to the one that made it. */
export function announceInMemoryChange(params: {
	key: string
	name: string
	connection: object
	change: InMemoryChange
}): void {
	const { key, name, connection, change } = params
	const message = { ...change, timestamp: Date.now() } as ProjectChannelMessage
	for (const entry of Array.from(LISTENERS.get(key) ?? [])) {
		tellListener({
			listener: entry.listener,
			value: { type: 'change', message, own: entry.connection === connection },
			of: changesOfProject({ name }),
		})
	}
}

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
