import type { HISTORY_ENTRY_STATE, HISTORY_PART, RECORD_INDEXES } from './engine.constants'
import type { DialecteErrorKey } from '@/errors'
import type { Perf } from '@/perf'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { DocumentStatus } from '@/project/types'
import type {
	ExportControl,
	ExportFileOptions,
	ExportFileResult,
	ImportControl,
	ImportFileOptions,
	ImportFileResult,
	ImportPhase,
	ImportProgress,
	Store,
} from '@/store/store.types'
import type { AnyRawRecord } from '@/types'
import type { Database, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm'

/** How a page cache follows the device's memory: `mibPerGiB` per GiB, held between a floor and a ceiling. */
export type DeviceCacheRule = {
	mibPerGiB: number
	floorMiB: number
	ceilingMiB: number
}

/** What an engine may be told at start; a field left out takes its default. */
export type SqliteEngineOptions = {
	/** The rule the steady cache and the import cache follow from the device's memory. */
	cacheRule: DeviceCacheRule
	/**
	 * A steady cache of this many MiB, instead of the one the rule gives. Not a memory cap: an import
	 * raises the cache to the rule's size while it runs.
	 */
	steadyCacheMiB?: number
	/** How long an import writes in one transaction before it commits and lets other calls run. */
	importWindowMs: number
}

export type OpenSqliteEngineParams = {
	sqlite3: Sqlite3Static
	/** The project's database, open: the engine is its only user from now on. */
	db: Database
	/** The dialecte the project belongs to, kept in a new file. */
	dialecteId: string
	/** The project's name, said in the engine's refusals. */
	name: string
	/** What the engine imports with: without it, an import is refused (`IMPORT_FAILED`). */
	runtime?: StoreRuntime
	options?: Partial<SqliteEngineOptions>
}

/** The port members an engine serves, with the port's own signatures. */
export type SqliteEngineMember =
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
export type SqliteImportParams = {
	file: File
	options?: ImportFileOptions
	/** The caller's id for this import, kept on the document's registry row. */
	writeId: string
}

/** An export as a client asks the engine for it: plain data, the progress listener apart. */
export type SqliteExportParams = {
	documentId: string
	options?: ExportFileOptions
	/** The caller's id for this export, by which it is aborted; one export of an id runs at a time. */
	exportId: string
}

/** An export as the engine runs it: the client that asked for it owns it. */
export type SqliteEngineExportParams = SqliteExportParams & {
	clientId: string
}

/** A commit as a client hands it to the engine: plain data, the progress listener apart. */
export type SqliteCommitParams = {
	documentId: string
	/** The caller's id for this commit, kept on its history entry. */
	writeId: string
	creates: AnyRawRecord[]
	updates: AnyRawRecord[]
	deletes: string[]
}

/** How far a commit is, as the port tells it: the operations written, out of all of them. */
export type CommitProgressListener = (current: number, total: number) => void

/** A commit on the engine's file; `settle` commits the running import's window first. */
export type CommitRecordsParams = SqliteCommitParams & {
	sqlite3: Sqlite3Static
	db: Database
	settle: () => void
}

/** An undo or a redo on the engine's file; `settle` commits the running import's window first. */
export type HistoryStepParams = {
	sqlite3: Sqlite3Static
	db: Database
	documentId: string
	direction: HistoryDirection
	settle: () => void
}

/** An import as the engine runs it: the client that asked for it owns it. */
export type SqliteEngineImportParams = SqliteImportParams & {
	clientId: string
}

/**
 * The port members an engine serves alike to every client, with the port's signatures: registry,
 * reads, bulk writes, write outcomes, history; and a commit, its progress listener an argument of its own.
 */
export type SqliteEngineMembers = Pick<Store, SqliteEngineMember> &
	SqliteEngineBlobMembers & {
		commit: (params: SqliteCommitParams, onProgress?: CommitProgressListener) => Promise<void>
	}

/** The blob members of the port an engine serves, with the port's signatures (a `Blob` crosses a port as it is). */
export type SqliteEngineBlobMember =
	| 'addBlob'
	| 'getBlob'
	| 'getBlobsByDocument'
	| 'getBlobsByRecord'
	| 'getStandaloneBlobs'
	| 'attachBlob'
	| 'detachBlob'
	| 'removeBlob'

export type SqliteEngineBlobMembers = Pick<Store, SqliteEngineBlobMember>

/** The store port as one client of an engine reaches it: an import's progress listener is an argument of its own. */
export type SqliteEngineApi = SqliteEngineMembers & {
	importFile: (
		params: SqliteImportParams,
		onProgress?: ImportControl['onProgress'],
	) => Promise<ImportFileResult>
	/** Abort the import of that id: it is refused `IMPORT_ABORTED` and leaves nothing; an id no import runs is ignored. */
	abortImport: (params: { writeId: string }) => Promise<void>
	exportFile: (
		params: SqliteExportParams,
		onProgress?: ExportControl['onProgress'],
	) => Promise<ExportFileResult>
	/** Abort the export of that id: it is refused `EXPORT_ABORTED`; an id no export runs is ignored. */
	abortExport: (params: { exportId: string }) => Promise<void>
}

/** One project's database behind the store port: the single writer of its file, serving every client. */
export type SqliteEngine = Omit<SqliteEngineApi, 'importFile' | 'exportFile'> & {
	/** An import owned by the client that asked for it; one import runs at a time, the others wait their turn. */
	importFile: (
		params: SqliteEngineImportParams,
		onProgress?: ImportControl['onProgress'],
	) => Promise<ImportFileResult>
	/** Abort every import the client owns, running or waiting: its connection is gone. */
	abortImportsOf: (params: { clientId: string }) => void
	/** An export owned by the client that asked for it; an id that runs already is refused (`ASSERTION_FAILED`). */
	exportFile: (
		params: SqliteEngineExportParams,
		onProgress?: ExportControl['onProgress'],
	) => Promise<ExportFileResult>
	/** Abort every export the client owns: its connection is gone. */
	abortExportsOf: (params: { clientId: string }) => void
	/** The engine as that client reaches it: its imports owned by it, nothing more than the port. */
	clientView: (params: { clientId: string }) => SqliteEngineApi
	/**
	 * Abort every import and every export, then close the database; the engine refuses every call after
	 * (`STORE_CLOSED`).
	 */
	close: () => void
}

/** One import in the queue: its owner, its id, the controller that aborts it. */
export type ImportQueueEntry = {
	writeId: string
	clientId: string
	controller: AbortController
	/** Whether its turn has come (it runs, or it was aborted while it waited). */
	hasTurn: boolean
	/** Whether its work runs: from then on its registry row says what became of it. */
	running: boolean
	/** Gives it its turn. */
	start: () => void
}

/** The imports of an engine, one running at a time, the others waiting their turn in order. */
export type ImportQueue = {
	/** Run `work` once every import before it is done; `work` is given the import's abort signal. */
	run: <GenericResult>(params: {
		writeId: string
		clientId: string
		work: (signal: AbortSignal) => Promise<GenericResult>
	}) => Promise<GenericResult>
	abort: (params: { writeId: string }) => void
	abortOwnedBy: (params: { clientId: string }) => void
	abortAll: () => void
	/** Whether an import of that id waits (its turn not come, or come and its work not begun): no registry row yet. */
	waits: (params: { writeId: string }) => boolean
}

/** An index of a record table. */
export type RecordIndex = keyof typeof RECORD_INDEXES

/** A registered document's row number and its record table. */
export type DocumentTable = {
	seq: number
	table: string
}

/** A part of a history entry: what a commit created, each updated record before and after it, what it deleted. */
export type HistoryPart = keyof typeof HISTORY_PART

/** Where a history entry stands. */
export type HistoryEntryState = keyof typeof HISTORY_ENTRY_STATE

/** Which way an entry is applied: as committed (a commit, a redo), or reverted (an undo). */
export type HistoryDirection = 'forward' | 'back'

/** A history entry, by its row id. */
export type HistoryEntryRef = {
	id: number
}

/** A registered document's row number, its status, its record table and its history-rows table. */
export type DocumentTables = {
	seq: number
	status: DocumentStatus
	records: string
	history: string
}

/** One bind for the row sink: records already checked, into the document's table, timed on the import's perf. */
export type RecordSinkParams = {
	db: Database
	table: string
	records: AnyRawRecord[]
	perf: Perf
}

/** What an import's window transactions run with. */
export type ImportWindowParams = {
	sqlite3: Sqlite3Static
	db: Database
	perf: Perf
	/** How long one window transaction writes before it commits. */
	windowMs: number
	/** The page cache while the import runs, and the one the engine keeps otherwise. */
	importCacheMiB: number
	steadyCacheMiB: number
}

/** Where an import's window stands. */
export type ImportWindowState = {
	/** When the open transaction began; none open when undefined. */
	openedAt: number | undefined
	/** Whether the connection runs with synchronous off. */
	synchronousOff: boolean
	/** Whether the import cache is raised. */
	cacheRaised: boolean
	/** The failure of a commit that lost the window's records, refused at the import's next window. */
	lost: Error | undefined
}

/**
 * The transactions an import writes in: time-capped, synchronous off, the import cache held from the
 * first write to the end; every other write of the engine runs between two of them, durable.
 */
export type ImportWindow = {
	/** Run `work` in the open transaction, opened first when none is. */
	write: <GenericResult>(work: () => GenericResult) => GenericResult
	/** Commit the open transaction once it has written for the window's time; answers whether it did. */
	commitIfDue: () => boolean
	/** Run `work` alone in a transaction of its own (an index build: one long statement). */
	alone: <GenericResult>(work: () => GenericResult) => GenericResult
	/** Commit what is open and make the connection durable for another connection's write; the import cache stays. */
	settle: () => void
	/** Commit what is open and give the connection back its durable settings: the import is complete. */
	finish: () => void
	/** Roll back what is open and give the connection back its durable settings; nothing to do on a closed database. */
	end: () => void
}

/** The import an engine runs, by its window: none between two imports. */
export type RunningImport = {
	window: ImportWindow | undefined
}

/** What an import's target writes with: the engine's connection and state, and the import's own perf, abort and file. */
export type ImportTargetParams = {
	sqlite3: Sqlite3Static
	db: Database
	perf: Perf
	signal: AbortSignal
	file: File
	/** The engine's record count per document, kept in step by the import's writes. */
	counts: Map<string, number>
	/** The engine's removal of a document (table, row, free pages): what a failed import leaves goes. */
	removeDocument: (params: { documentId: string }) => void
	/** The import's transactions. */
	window: ImportWindow
	/** How long the import works before the engine's queue gets a turn (its window's time). */
	windowMs: number
	/** Tell the caller what the import does now (`indexing` around an index build). */
	tellPhase: (params: { phase: ImportPhase }) => void
	/** Whether the file gives its own record ids (they may repeat); generated ids never do. */
	customIds: boolean
}

/** The import's progress as the engine relays it: the parser's told on, the last one kept to tell a phase with. */
export type ImportProgressRelay = {
	onProgress: (progress: ImportProgress) => void
	tellPhase: (params: { phase: ImportPhase }) => void
}

/** What an import's target knows of its document: the one it registered (with its table) and the indexes built on it. */
export type ImportTargetState = {
	registered: (DocumentTable & { documentId: string }) | undefined
	built: Set<RecordIndex>
	/**
	 * The ids stored so far when the file gives its own ids, until the id index exists: a repeated
	 * one is refused at its batch. About 100 bytes an id (0.4 GB for 4 million records): only test
	 * setups give their own ids.
	 */
	givenIds: Set<string> | undefined
}

/** Reads by id on one table through one prepared statement. */
export type RecordReadsById = {
	read: (ids: readonly string[]) => Map<string, AnyRawRecord>
	finalize: () => void
}

/** The statement an export reads its document's records through, with what it was prepared for. */
export type ExportReads = {
	current: { documentId: string; removals: number; statement: RecordReadsById } | undefined
}

/** An export the engine runs: its owner, its abort, the statement it reads through. */
export type RunningExport = {
	clientId: string
	controller: AbortController
	reads: ExportReads
}

/** Columns of one value on every row an insert writes, before the record's own. */
export type LeadColumns = {
	columns: string[]
	values: SqlValue[]
}

/** Records encoded as rows of a document table: JSON arrays of up to `ROWS_PER_BIND` rows each. */
export type EncodedRows = {
	payloads: string[]
}

/** The store errors an engine throws a failure of SQLite as, one per kind of operation. */
export type StoreFailureKey = Extract<
	DialecteErrorKey,
	| 'STORE_CONNECTION_FAILED'
	| 'STORE_READ_FAILED'
	| 'STORE_COMMIT_FAILED'
	| 'STORE_BULK_ADD_FAILED'
	| 'STORE_BULK_UPDATE_FAILED'
	| 'STORE_DELETE_FAILED'
>
