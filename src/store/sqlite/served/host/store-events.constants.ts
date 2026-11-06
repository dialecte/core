import { changed } from './changed'

import type { StoreEventOf } from './host.types'
import type { DocumentRecord } from '@/project/types'
import type { ImportFileResult } from '@/store/store.types'
import type { BlobAttachment, BlobRecord } from '@/types'

/**
 * What a member's success announces, from its arguments and its answer; a member left out announces nothing, and
 * neither does one whose answer says it changed nothing (`false`: an undo with nothing to undo, an unknown document
 * removed or updated, an empty bulk write, a blob attached where it is or detached where it is not, an unknown blob
 * removed).
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
		return changed({ value }) ? { type: 'commit', documentId: args[0] as string } : undefined
	},
	commit: function committed({ args }) {
		return { type: 'commit', documentId: (args[0] as { documentId: string }).documentId }
	},
	undo: function undone({ args, value }) {
		return changed({ value }) ? { type: 'commit', documentId: args[0] as string } : undefined
	},
	redo: function redone({ args, value }) {
		return changed({ value }) ? { type: 'commit', documentId: args[0] as string } : undefined
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
