import { ENGINE_SIGNAL } from '../engine.constants'

import type { AnnouncedCall, EngineEventSignal, StoreEventOf, StoreEvents } from './host.types'
import type { DocumentRecord } from '@/project/types'
import type { ImportFileResult } from '@/store/store.types'
import type { BlobAttachment, BlobRecord } from '@/types'

/**
 * What a member's success announces, from its arguments and its answer; a member left out announces nothing, and
 * neither does one whose answer says it changed nothing (`false`: an undo with nothing to undo, an unknown document
 * removed or updated, an empty bulk write, a blob attached where it is or detached where it is not, an unknown blob
 * removed).
 */
const STORE_EVENT_OF_MEMBER: StoreEventOf = {
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

/** A member answered that it changed something (a member that says nothing of it did). */
function changed(params: { value: unknown }): boolean {
	return params.value !== false
}

/**
 * The change a member's success makes, as every client of the engine is told it: the project event (its timestamp
 * now), the connection the call was made for, and the call's write id; none when it changed nothing.
 */
export function storeEventOf(params: AnnouncedCall): EngineEventSignal | undefined {
	const { member, args, value, connectionId } = params
	const message = STORE_EVENT_OF_MEMBER[member]?.({ args, value })
	if (!message) return undefined
	const writeId = writeIdOf({ args })
	return {
		type: ENGINE_SIGNAL.event,
		message: { ...message, timestamp: Date.now() },
		connectionId,
		...(writeId !== undefined && { writeId }),
	}
}

/** The write id a call carries (a commit's, an import's: their params' `writeId`). */
function writeIdOf(params: { args: unknown[] }): string | undefined {
	const [first] = params.args
	if (typeof first !== 'object' || first === null || !('writeId' in first)) return undefined
	const { writeId } = first as { writeId: unknown }
	return typeof writeId === 'string' ? writeId : undefined
}

/**
 * The engine's announcer: each change posted on every client port it serves now (`ports`), the caller's
 * included - on the caller's port before its call's answer. A port that cannot take it (closed) is skipped.
 */
export function createStoreEvents(params: { ports: () => Iterable<MessagePort> }): StoreEvents {
	const { ports } = params
	let closed = false
	return {
		announce: function announce(call) {
			if (closed) return
			const signal = storeEventOf(call)
			if (!signal) return
			for (const port of ports()) {
				try {
					port.postMessage(signal)
				} catch {
					// a port gone: its client hears nothing more of this engine
				}
			}
		},
		close: function stopAnnouncing() {
			closed = true
		},
	}
}
