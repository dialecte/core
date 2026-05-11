import type { DocumentState, DocumentRecord } from '@/project'

/**
 * Build the initial DocumentState for a newly registered document.
 */
export function buildDocumentState(document: DocumentRecord): DocumentState {
	return {
		document,
		loading: false,
		error: null,
		progress: null,
		history: [],
		lastUpdate: null,
		canUndo: false,
		canRedo: false,
	}
}

/**
 * Reconcile in-memory document state Map with the current store contents.
 * Adds new documents, removes stale ones. Returns the mutated map for convenience.
 */
export function reconcileDocumentState(
	state: Map<string, DocumentState>,
	storeDocuments: DocumentRecord[],
): Map<string, DocumentState> {
	const existingIds = new Set(storeDocuments.map((document) => document.id))

	for (const document of storeDocuments) {
		if (!state.has(document.id)) {
			state.set(document.id, buildDocumentState(document))
		}
	}

	for (const id of state.keys()) {
		if (!existingIds.has(id)) {
			state.delete(id)
		}
	}

	return state
}
