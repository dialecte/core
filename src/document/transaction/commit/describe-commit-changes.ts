import { COMMIT_CHANGES_MAX } from '@/project/project.constants'

import type {
	ChangedRecord,
	CommitChanges,
	CommitWrites,
	PlacedRecord,
	UnknownCommitChanges,
} from '@/project/types'

/**
 * What one commit changed, from its merged writes, in the order given: each record's id, tag and parent id (after the
 * write for created and updated, before it for deleted). Past `COMMIT_CHANGES_MAX` refs in all, `{ unknown: true }`.
 * A move between parents stages the moved record and both parents, so all three are in `updated`.
 * The writes are the merged operations (`mergeOperations`), so each record appears once, in its final list.
 */
export function describeCommitChanges(params: CommitWrites): CommitChanges | UnknownCommitChanges {
	const { creates, updates, deletes } = params
	if (creates.length + updates.length + deletes.length > COMMIT_CHANGES_MAX)
		return { unknown: true }
	return {
		created: creates.map(changedRecordOf),
		updated: updates.map(changedRecordOf),
		deleted: deletes.map(changedRecordOf),
	}
}

function changedRecordOf(record: PlacedRecord): ChangedRecord {
	return { id: record.id, tagName: record.tagName, parentId: record.parent?.id ?? null }
}
