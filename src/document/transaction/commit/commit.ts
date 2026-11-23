import { changedRecordOf, describeCommitChanges } from './describe-commit-changes'
import { mergeOperations } from './merge-operations'

import { NOOP_PERF } from '@/perf'
import { isConnectionLost, lostWriteError, outcomeAfterLoss } from '@/store/lost-write'

import type { CommittedTransaction } from './commit.types'
import type { ProgressReporter } from '@/document/progress'
import type { DocumentState } from '@/document/types'
import type { Perf } from '@/perf'
import type { CommitAnswer, Store } from '@/store/store.types'
import type { AnyDialecteConfig, Operation } from '@/types'

/**
 * Write the merged staged operations as one commit under the caller's `writeId` and answer what it changed (`describeCommitChanges` over the
 * writes it handed the store) and the version the store answered for it; a commit lost with its connection whose
 * outcome reads `applied` answers the same changes and no version (its answer was lost).
 */
export async function commitTransaction<GenericConfig extends AnyDialecteConfig>(params: {
	/** The commit's id, drawn by its caller: kept on its history entry, asked after a lost connection, never committed again. */
	writeId: string
	stagedOperations: Operation<GenericConfig>[]
	store: Store
	documentId: string
	documentState: DocumentState
	progress: ProgressReporter
	perf?: Perf
}): Promise<CommittedTransaction> {
	const {
		writeId,
		stagedOperations,
		store,
		documentId,
		documentState,
		progress,
		perf = NOOP_PERF,
	} = params

	perf.start('core::commit')
	perf.start('core::commit::merge')
	const { creates, updates, deletes } = mergeOperations(stagedOperations)
	perf.stop('core::commit::merge')
	const writes = {
		creates: creates.map((op) => op.newRecord),
		updates: updates.map((op) => op.newRecord),
		deletes: deletes.map((op) => changedRecordOf(op.oldRecord)),
	}

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

	let answer: CommitAnswer | void = undefined
	try {
		perf.count('core::store::commit')
		perf.start('core::store::commit')
		try {
			answer = await store.commit({
				documentId,
				writeId,
				creates: writes.creates,
				updates: writes.updates,
				deletes: writes.deletes,
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
	return { changes: describeCommitChanges(writes), version: answer?.version }
}
