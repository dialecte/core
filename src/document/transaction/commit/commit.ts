import { mergeOperations } from './merge-operations'

import { NOOP_PERF } from '@/perf'
import { isConnectionLost, lostWriteError, outcomeAfterLoss } from '@/store/lost-write'

import type { ProgressReporter } from '@/document/progress'
import type { DocumentState } from '@/document/types'
import type { Perf } from '@/perf'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig, Operation } from '@/types'

export async function commitTransaction<GenericConfig extends AnyDialecteConfig>(params: {
	stagedOperations: Operation<GenericConfig>[]
	store: Store
	documentId: string
	documentState: DocumentState
	progress: ProgressReporter
	perf?: Perf
}): Promise<void> {
	const { stagedOperations, store, documentId, documentState, progress, perf = NOOP_PERF } = params

	perf.start('core::commit')
	perf.start('core::commit::merge')
	const { creates, updates, deletes } = mergeOperations(stagedOperations)
	perf.stop('core::commit::merge')

	const totalOperations = creates.length + updates.length + deletes.length

	documentState.loading = true
	progress.plan({ steps: totalOperations })

	// store.commit reports absolute cumulative progress; convert it to relative
	// nextStep() calls (robust to batched jumps).
	let reported = 0
	function advanceTo(current: number): void {
		while (reported < current) {
			progress.nextStep()
			reported++
		}
	}

	// the commit's id: asked after a lost connection, never committed again
	const writeId = crypto.randomUUID()
	try {
		perf.count('core::store::commit')
		perf.start('core::store::commit')
		try {
			await store.commit({
				documentId,
				writeId,
				creates: creates.map((op) => op.newRecord),
				updates: updates.map((op) => op.newRecord),
				deletes: deletes.map((op) => op.oldRecord.id),
				onProgress: (current) => {
					advanceTo(current)
				},
			})
		} catch (error) {
			if (!isConnectionLost({ thrown: error })) throw error
			// lost with its connection: it may have landed - asked once; applied, it stands
			const outcome = await outcomeAfterLoss({ store, writeId })
			if (outcome !== 'applied') throw lostWriteError({ thrown: error, writeId, outcome })
		}
		perf.stop('core::store::commit')
	} catch (error) {
		documentState.loading = false
		progress.endPlan()
		perf.stop('core::commit')
		throw error
	}

	documentState.lastUpdate = Date.now()
	progress.endPlan()
	perf.stop('core::commit')
}
