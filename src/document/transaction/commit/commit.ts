import { mergeOperations } from './merge-operations'

import type { DocumentState } from '@/document/types'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig, Operation } from '@/types'

export async function commitTransaction<GenericConfig extends AnyDialecteConfig>(params: {
	stagedOperations: Operation<GenericConfig>[]
	store: Store
	documentId: string
	documentState: DocumentState
}): Promise<void> {
	const { stagedOperations, store, documentId, documentState } = params

	const { creates, updates, deletes } = mergeOperations(stagedOperations)

	const totalOperations = creates.length + updates.length + deletes.length

	documentState.loading = true
	documentState.progress = { message: 'Committing changes...', current: 0, total: totalOperations }

	try {
		await store.commit({
			documentId,
			creates: creates.map((op) => op.newRecord),
			updates: updates.map((op) => op.newRecord),
			deletes: deletes.map((op) => op.oldRecord.id),
			onProgress: (current, total) => {
				documentState.progress = { message: 'Committing changes...', current, total }
			},
		})
	} catch (error) {
		documentState.loading = false
		documentState.progress = null
		throw error
	}

	documentState.lastUpdate = Date.now()
	// Clear progress once the commit succeeds: progress must be `null` when the document is idle,
	// otherwise the last "Committing changes..." value lingers globally and any consumer reading
	// `state.progress` between operations shows a stale, misleading status.
	documentState.progress = null
}
