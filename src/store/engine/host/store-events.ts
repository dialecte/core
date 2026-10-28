import { projectChannelName } from '@/project/project-channel'

import type { StoreEventOf, StoreEvents } from './host.types'
import type { DocumentRecord } from '@/project/types'
import type { ImportFileResult } from '@/store/store.types'
import type { BlobAttachment, BlobRecord } from '@/types'

/**
 * What a member's success announces on the project's channel, from its arguments and its answer; a
 * member left out announces nothing. The engine is the project's one writer: it tells every realm.
 */
const STORE_EVENT_OF_MEMBER: StoreEventOf = {
	registerDocument: function documentRegistered({ args }) {
		return { type: 'init-empty-document', documentId: (args[0] as DocumentRecord).id }
	},
	removeDocument: function documentRemoved({ args }) {
		return { type: 'document-removed', documentId: args[0] as string }
	},
	bulkWrite: function recordsWritten({ args }) {
		return { type: 'commit', documentId: args[0] as string }
	},
	commit: function committed({ args }) {
		return { type: 'commit', documentId: (args[0] as { documentId: string }).documentId }
	},
	undo: function undone({ args }) {
		return { type: 'commit', documentId: args[0] as string }
	},
	redo: function redone({ args }) {
		return { type: 'commit', documentId: args[0] as string }
	},
	importFile: function imported({ value }) {
		return { type: 'document-imported', documentId: (value as ImportFileResult).record.id }
	},
	addBlob: function blobAdded({ args }) {
		const entry = args[0] as BlobRecord
		return { type: 'blob-added', blobId: entry.id, documentId: entry.documentId }
	},
	attachBlob: function blobAttached({ args }) {
		return { type: 'blob-attached', blobId: args[0] as string, ref: args[1] as BlobAttachment }
	},
	detachBlob: function blobDetached({ args }) {
		return {
			type: 'blob-detached',
			blobId: args[0] as string,
			ref: args[1] as { documentId: string; recordRef: string },
		}
	},
	removeBlob: function blobRemoved({ args }) {
		return { type: 'blob-removed', blobId: args[0] as string }
	},
}

/** The project's channel, as the engine posts on it: each event tagged with the client whose call made it. */
export function createStoreEvents(params: { project: string }): StoreEvents {
	const channel = new BroadcastChannel(projectChannelName({ name: params.project }))
	return {
		announce: function announce({ member, args, value, clientId }) {
			const eventOf = STORE_EVENT_OF_MEMBER[member]
			if (!eventOf) return
			channel.postMessage({ ...eventOf({ args, value }), timestamp: Date.now(), clientId })
		},
		close: function closeChannel() {
			channel.close()
		},
	}
}
