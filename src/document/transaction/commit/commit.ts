import { mergeOperations } from './merge-operations'

import type { DocumentState } from '@/document/types'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig, Operation } from '@/types'

export async function commitTransaction<GenericConfig extends AnyDialecteConfig>(params: {
	stagedOperations: Operation<GenericConfig>[]
	store: Store
	documentState: DocumentState
}): Promise<void> {
	const { stagedOperations, store, documentState } = params

	const { creates, updates, deletes } = mergeOperations(stagedOperations)

	const totalOperations = creates.length + updates.length + deletes.length

	documentState.activity = { method: 'commit', message: 'Committing changes...' }
	documentState.progress = { current: 0, total: totalOperations }

	try {
		await store.commit({
			creates: creates.map((op) => op.newRecord),
			updates: updates.map((op) => op.newRecord),
			deletes: deletes.map((op) => op.oldRecord.id),
			onProgress: (current, total) => {
				documentState.progress = { current, total }
			},
		})
	} catch (error) {
		documentState.activity = null
		documentState.progress = null
		throw error
	}

	documentState.lastUpdate = Date.now()
}
