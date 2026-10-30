import type { EngineApi } from '../engine.types'
import type { WireMemberSpec } from './wire.types'

/**
 * The version of what crosses between a client and an engine (the wire table, the signals, the control
 * messages): the engine says it as it opens, and a client of another version refuses it - each runs its
 * own copy of the library.
 */
export const ENGINE_WIRE_PROTOCOL = 1

/** How many causes of a thrown error cross a port with it: the deeper ones are left behind. */
export const WIRE_CAUSE_DEPTH = 4

/**
 * Every member of the engine a client calls over a port, and how it crosses: the one table of the wire
 * (a member of the engine's API missing here fails the type check).
 */
export const ENGINE_WIRE_MEMBERS = {
	registerDocument: { json: [{ argument: 0 }] },
	getDocument: {},
	getDocuments: {},
	updateDocument: { json: [{ argument: 1 }] },
	removeDocument: {},
	get: {},
	getByDocumentId: {},
	count: {},
	getByTagNameInDocument: {},
	getMany: {},
	bulkWrite: {
		json: [
			{ argument: 1, path: ['creates'] },
			{ argument: 1, path: ['updates'] },
		],
	},
	getWriteOutcome: {},
	undo: {},
	redo: {},
	getHistoryStatus: {},
	getChangeLog: {},
	commit: {
		json: [
			{ argument: 0, path: ['creates'] },
			{ argument: 0, path: ['updates'] },
		],
		listener: 1,
		identified: true,
	},
	// the metadata in the options lies one level down, as in the document the import registers
	importFile: { json: [{ argument: 0, path: ['options'] }], listener: 1, identified: true },
	abortImport: {},
	exportFile: { listener: 1, abortable: true },
	abortExport: {},
	addBlob: { json: [{ argument: 0 }] },
	getBlob: {},
	getBlobsByDocument: {},
	getBlobsByRecord: {},
	getStandaloneBlobs: {},
	attachBlob: { json: [{ argument: 1 }] },
	detachBlob: {},
	removeBlob: {},
} as const satisfies Record<keyof EngineApi, WireMemberSpec>
