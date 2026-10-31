import type { ENGINE_SIGNAL } from './engine.constants'
import type { ThrownData } from './wire/wire.types'
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
 * (`EngineStore`) and the engine's members as a client reaches them (`EngineApi`); for an engine in a
 * worker, its control messages, how values and errors cross a port (`wire`), the client side (engine
 * client, worker connector, liveness watch), the host side (a client port served, heartbeat, store
 * events) and the hub's router (which realm hosts each project's engine). The database and its worker
 * runtime are the engine's own: `store/sqlite`.
 */

/**
 * How the engine takes its project's lock: wait for it within the open budget (a successor of an
 * engine that ended, through the hub), or take it only if free (direct mode: a holder is another
 * realm's engine).
 */
export type EngineLockMode = 'wait' | 'if-available'

/**
 * What an engine is opened with: what every engine is told, and `settings`, what its kind of engine
 * needs besides (the SQLite engine: the consumer's wasm file and its options), passed through as is.
 */
export type EngineOpenParams<GenericSettings = unknown> = {
	project: string
	/**
	 * The dialecte and its version the realm expects the engine to run: an engine of another one refuses the
	 * open (`PROJECT_DIALECTE_MISMATCH`, `PROJECT_DIALECTE_VERSION_MISMATCH`) before it takes any lock or file.
	 */
	dialecteId: string
	dialecteVersion: string
	/**
	 * The creation id of the project the realm's view had open, when it comes back to it (a resume, an engine
	 * started again): none there, or another, is refused `PROJECT_DESTROYED_WHILE_AWAY`, nothing written.
	 */
	expectedCreationId?: string
	lock: EngineLockMode
	/**
	 * How long the engine may take to take its project: the lock, then its own checks of the files (SQLite
	 * probes its pool), from one deadline. The rest of the open (the database, the start's cleanup) is bounded
	 * by the realm's open window (`ENGINE_OPEN_WINDOW_MS`).
	 */
	budgetMs: number
	/** Measure the import's and the export's stages (`dev.perf`). */
	perf: boolean
	/** How often the engine beats while it works (`ENGINE_HEARTBEAT_INTERVAL_MS` when absent). */
	heartbeatIntervalMs?: number
	settings: GenericSettings
}

/** A control message a realm sends its engine worker; each is answered once by its `requestId`. */
export type EngineControlRequest<GenericSettings = unknown> =
	| ({ type: 'open'; requestId: number } & EngineOpenParams<GenericSettings>)
	| { type: 'adopt-client'; requestId: number; clientId: string; port: MessagePort }
	| { type: 'client-gone'; requestId: number; clientId: string }
	| { type: 'close'; requestId: number }
	| {
			type: 'destroy'
			requestId: number
			project: string
			/** The dialecte whose project it is: an engine of another one refuses (`PROJECT_DIALECTE_MISMATCH`), nothing removed. */
			dialecteId: string
			/**
			 * Direct mode takes the lock only if free (a holder is another realm's engine); through the hub
			 * the destroy waits for it (the engine the hub just released may hold it a moment).
			 */
			lock: EngineLockMode
			budgetMs: number
	  }

/** The engine worker's answer to a control message. */
export type EngineControlAnswer =
	| {
			type: 'opened'
			requestId: number
			dialecteId: string
			dialecteVersion: string
			/** The id the project's file was created with (another one once the project is destroyed and made again). */
			creationId: string
			/** The wire the engine speaks (`ENGINE_WIRE_PROTOCOL` of its copy of the library). */
			wireProtocol: number
			/** Whether the engine took its files back in this worker (closed then opened again) rather than set them up. */
			resumed: boolean
	  }
	| { type: 'adopted'; requestId: number }
	| { type: 'released'; requestId: number }
	| { type: 'closed'; requestId: number }
	| { type: 'destroyed'; requestId: number }
	| { type: 'failed'; requestId: number; thrown: ThrownData }

/** A sign of the engine's life its worker posts to the realm running it, beside the control answers. */
export type EngineLifeSignal = {
	type: (typeof ENGINE_SIGNAL)['heartbeat'] | (typeof ENGINE_SIGNAL)['busy']
}

/** `Omit` applied to each member of a union. */
export type DistributiveOmit<
	GenericUnion,
	GenericKey extends PropertyKey,
> = GenericUnion extends unknown ? Omit<GenericUnion, GenericKey> : never

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
