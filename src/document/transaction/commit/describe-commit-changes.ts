import { COMMIT_CHANGES_MAX } from '@/project/project.constants'

import type {
	ChangedRecord,
	CommitChanges,
	CommitWrites,
	HistoryImages,
	HistoryStepDirection,
	PlacedRecord,
	UnknownCommitChanges,
} from '@/project/types'
import type { ChangeLogEntry } from '@/store/store.types'

/**
 * What one commit changed, from its merged writes, in the order given: each record's id, tag and parent id (after the
 * write for created and updated, before it for deleted). Past `COMMIT_CHANGES_MAX` refs in all, `{ unknown: true }`.
 * A move between parents stages the moved record and both parents, so all three are in `updated`.
 * The writes are the merged operations (`mergeOperations`), so each record appears once, in its final list.
 *
 * @intent tell what a commit changed, build a custom store's commit announcement
 */
export function describeCommitChanges(params: CommitWrites): CommitChanges | UnknownCommitChanges {
	const { creates, updates, deletes } = params
	if (creates.length + updates.length + deletes.length > COMMIT_CHANGES_MAX)
		return { unknown: true }
	return {
		created: creates.map(changedRecordOf),
		updated: updates.map(changedRecordOf),
		deleted: deletes.map(copyOfRef),
	}
}

function copyOfRef(ref: ChangedRecord): ChangedRecord {
	return { id: ref.id, tagName: ref.tagName, parentId: ref.parentId }
}

/** A record's ref: its id, its tag and its parent's id (`null` for the root). */
export function changedRecordOf(record: PlacedRecord): ChangedRecord {
	return { id: record.id, tagName: record.tagName, parentId: record.parent?.id ?? null }
}

/**
 * What one history step applied, from the images its entry keeps: `forward` (a redo) tells the commit again, `back`
 * (an undo) its inverse - the deleted records created again under the parent they had, the updated ones with their
 * parent before the commit, the created ones deleted from the parent they were created under. Past
 * `COMMIT_CHANGES_MAX` refs, `{ unknown: true }`.
 *
 * @intent answer what an undo or a redo applied, in a custom store
 */
export function describeHistoryStep(params: {
	images: HistoryImages
	direction: HistoryStepDirection
}): CommitChanges | UnknownCommitChanges {
	const { images, direction } = params
	const { creates, befores, afters, deletes } = images
	if (direction === 'forward') {
		return describeCommitChanges({
			creates,
			updates: afters,
			deletes: deletes.map(changedRecordOf),
		})
	}
	return describeCommitChanges({
		creates: deletes,
		updates: befores,
		deletes: creates.map(changedRecordOf),
	})
}

/** What one history step applied, from a changelog entry's operations (the images the in-memory and IndexedDB stores keep). */
export function describeChangeLogStep(params: {
	operations: ChangeLogEntry['operations']
	direction: HistoryStepDirection
}): CommitChanges | UnknownCommitChanges {
	const { operations, direction } = params
	return describeHistoryStep({
		images: {
			creates: operations.creates,
			befores: operations.updates.map((update) => update.before),
			afters: operations.updates.map((update) => update.after),
			deletes: operations.deletes,
		},
		direction,
	})
}
