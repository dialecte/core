import { changed } from './changed'

import { describeCommitChanges } from '@/document/transaction/commit/describe-commit-changes'
import { newCallId } from '@/store/json-values'

import type { EngineCommitParams } from '../engine.types'
import type { StoreEventOf } from './host.types'
import type { DocumentRecord, ProjectChannelMessage } from '@/project/types'
import type {
	CommitAnswer,
	DistributiveOmit,
	HistoryStep,
	ImportFileResult,
} from '@/store/store.types'
import type { BlobAttachment, BlobRecord } from '@/types'

/**
 * What a member's success announces, from its arguments and its answer; a member left out announces nothing, and
 * neither does one whose answer says it changed nothing (`false`: an undo with nothing to undo, an unknown document
 * removed or updated, an empty bulk write, a blob attached where it is or detached where it is not, an unknown blob
 * removed). A commit tells its changes from its arguments under its `writeId`, an undo or a redo the changes it
 * answered under the `changeId` it was given, each with the version it answered; a bulk write tells them unknown (its patches carry no tag) under an id
 * drawn here - the event is built once and posted to every port, so every connection hears the same id.
 */
export const STORE_EVENT_OF_MEMBER: StoreEventOf = {
	registerDocument: function documentRegistered({ args }) {
		return { type: 'init-empty-document', documentId: (args[0] as DocumentRecord).id }
	},
	updateDocument: function documentUpdated({ args, value }) {
		return changed({ value })
			? { type: 'document-updated', documentId: args[0] as string }
			: undefined
	},
	removeDocument: function documentRemoved({ args, value }) {
		return changed({ value })
			? { type: 'document-removed', documentId: args[0] as string }
			: undefined
	},
	bulkWrite: function recordsWritten({ args, value }) {
		return changed({ value })
			? {
					type: 'commit',
					documentId: args[0] as string,
					changeId: newCallId(),
					changes: { unknown: true },
				}
			: undefined
	},
	commit: function committed({ args, value }) {
		const { documentId, writeId, creates, updates, deletes } = args[0] as EngineCommitParams
		return {
			type: 'commit',
			documentId,
			changeId: writeId,
			changes: describeCommitChanges({ creates, updates, deletes }),
			version: (value as CommitAnswer).version,
		}
	},
	undo: function undone({ args, value }) {
		return changed({ value }) ? historyStepEvent({ args, step: value as HistoryStep }) : undefined
	},
	redo: function redone({ args, value }) {
		return changed({ value }) ? historyStepEvent({ args, step: value as HistoryStep }) : undefined
	},
	importFile: function imported({ value }) {
		return { type: 'document-imported', documentId: (value as ImportFileResult).record.id }
	},
	addBlob: function blobAdded({ args }) {
		const entry = args[0] as BlobRecord
		return { type: 'blob-added', blobId: entry.id, documentId: entry.documentId }
	},
	attachBlob: function blobAttached({ args, value }) {
		if (!changed({ value })) return undefined
		return { type: 'blob-attached', blobId: args[0] as string, ref: args[1] as BlobAttachment }
	},
	detachBlob: function blobDetached({ args, value }) {
		if (!changed({ value })) return undefined
		return {
			type: 'blob-detached',
			blobId: args[0] as string,
			ref: args[1] as { documentId: string; recordRef: string },
		}
	},
	removeBlob: function blobRemoved({ args, value }) {
		return changed({ value }) ? { type: 'blob-removed', blobId: args[0] as string } : undefined
	},
}

/** An undo's or a redo's event: the document it stepped, the id and the changes it answered. */
function historyStepEvent(params: {
	args: unknown[]
	step: HistoryStep
}): DistributiveOmit<ProjectChannelMessage, 'timestamp'> {
	const { args, step } = params
	const { documentId } = args[0] as { documentId: string }
	return {
		type: 'commit',
		documentId,
		changeId: step.changeId,
		changes: step.changes,
		version: step.version,
	}
}
