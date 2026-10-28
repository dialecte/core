import type {
	ExportControl,
	ExportFileOptions,
	ExportFileResult,
	ImportControl,
	ImportFileOptions,
	ImportFileResult,
	Store,
} from '@/store/store.types'
import type { AnyRawRecord } from '@/types'

/*
 * store/engine - a project served by one engine, whatever its database: the store port over that engine
 * (`EngineStore`), the engine's members as a client reaches them (`EngineApi`), and the hub's router
 * (which realm hosts each project's engine). The database is the engine's own: `store/sqlite`.
 */

/** The port members an engine serves, with the port's own signatures. */
export type EngineMember =
	| 'registerDocument'
	| 'getDocument'
	| 'getDocuments'
	| 'updateDocument'
	| 'removeDocument'
	| 'get'
	| 'getByDocumentId'
	| 'count'
	| 'getByTagNameInDocument'
	| 'getMany'
	| 'bulkWrite'
	| 'getWriteOutcome'
	| 'undo'
	| 'redo'
	| 'getHistoryStatus'
	| 'getChangeLog'

/** A file to import, as a client hands it to the engine: plain data, the progress listener apart. */
export type EngineImportParams = {
	file: File
	options?: ImportFileOptions
	/** The caller's id for this import, kept on the document's registry row. */
	writeId: string
}

/** An export as a client asks the engine for it: plain data, the progress listener apart. */
export type EngineExportParams = {
	documentId: string
	options?: ExportFileOptions
	/** The caller's id for this export, by which it is aborted; one export of an id runs at a time. */
	exportId: string
}

/** A commit as a client hands it to the engine: plain data, the progress listener apart. */
export type EngineCommitParams = {
	documentId: string
	/** The caller's id for this commit, kept on its history entry. */
	writeId: string
	creates: AnyRawRecord[]
	updates: AnyRawRecord[]
	deletes: string[]
}

/** How far a commit is, as the port tells it: the operations written, out of all of them. */
export type CommitProgressListener = (current: number, total: number) => void

/**
 * The port members an engine serves alike to every client, with the port's signatures: registry,
 * reads, bulk writes, write outcomes, history; and a commit, its progress listener an argument of its own.
 */
export type EngineMembers = Pick<Store, EngineMember> &
	EngineBlobMembers & {
		commit: (params: EngineCommitParams, onProgress?: CommitProgressListener) => Promise<void>
	}

/** The blob members of the port an engine serves, with the port's signatures (a `Blob` crosses a port as it is). */
export type EngineBlobMember =
	| 'addBlob'
	| 'getBlob'
	| 'getBlobsByDocument'
	| 'getBlobsByRecord'
	| 'getStandaloneBlobs'
	| 'attachBlob'
	| 'detachBlob'
	| 'removeBlob'

export type EngineBlobMembers = Pick<Store, EngineBlobMember>

/** The store port as one client of an engine reaches it: an import's progress listener is an argument of its own. */
export type EngineApi = EngineMembers & {
	importFile: (
		params: EngineImportParams,
		onProgress?: ImportControl['onProgress'],
	) => Promise<ImportFileResult>
	/** Abort the import of that id: it is refused `IMPORT_ABORTED` and leaves nothing; an id no import runs is ignored. */
	abortImport: (params: { writeId: string }) => Promise<void>
	exportFile: (
		params: EngineExportParams,
		onProgress?: ExportControl['onProgress'],
	) => Promise<ExportFileResult>
	/** Abort the export of that id: it is refused `EXPORT_ABORTED`; an id no export runs is ignored. */
	abortExport: (params: { exportId: string }) => Promise<void>
}
