import type { Diagnostic } from '@/diagnostics'
import type { DocumentState, ExtensionModules } from '@/document'
import type { DialecteError } from '@/errors'
import type { Perf } from '@/perf'
import type { DOCUMENT_UPDATE_FIELDS } from '@/store/document-path.constants'
import type { ImportControl, ImportFileOptions, Store } from '@/store/store.types'
import type { AnyDialecteConfig, BlobAttachment, BlobRecord, DialecteHooks } from '@/types'

// ── DocumentRecord ───────────────────────────────────────────────────────────

/**
 * DocumentRecord - metadata entry for a file registered in a Project.
 *
 * Stored in the `_files` table. Each file gets its own `xel_{id}` table
 * for XML records (created/dropped via dynamic Dexie versioning).
 */
export type DocumentRecord = {
	/** Primary key - crypto.randomUUID() */
	id: string
	/** Original filename without extension */
	name: string
	/** File extension including leading dot (e.g. ".scd", ".icd", ".nsd") */
	extension: string
	/** Key into Project's config registry - determines which DialecteConfig applies */
	configKey: string
	/** Timestamp of file registration */
	createdAt: number
	/** Extensible per-file metadata, populated by config.extractMetadata at import */
	metadata?: Record<string, unknown>
	/**
	 * `importing` from registration until the last record is stored, `ready` after. A failed or
	 * aborted import removes the document; one left `importing` by an import that no longer runs is
	 * removed when the store opens. A document is never opened, listed or served while `importing`.
	 */
	status: DocumentStatus
	/** The id of the import that wrote the document - what `Store.getWriteOutcome` is asked by. */
	writeId?: string
	/**
	 * Where the document sits in the project: its folders, then its file name, joined by `/` (`substations/north.scd`).
	 * Its file name is always `name` + `extension`; one document only holds a place, and a document's path is never
	 * a folder of another's. Absent: the document has no place yet.
	 */
	path?: string
}

export type DocumentStatus = 'importing' | 'ready'

/**
 * What a document's registry entry may be updated with (`DOCUMENT_UPDATE_FIELDS`): a field given as `undefined` is
 * left as it was, a key beyond these is ignored.
 */
export type DocumentUpdates = Partial<Pick<DocumentRecord, (typeof DOCUMENT_UPDATE_FIELDS)[number]>>

// ── DocumentState ────────────────────────────────────────────────────────────

/**
 * DocumentState - observable state for a single document within a Project.
 * Extends DocumentState with project-level fields.
 */
export type DocumentEntry = DocumentState & {
	record: DocumentRecord
	canUndo: boolean
	canRedo: boolean
}

/**
 * ProjectState - top-level observable state for a Project.
 * In Vue: reactive(project.state) makes all fields trigger re-renders.
 */
export type ProjectState = {
	documents: Map<string, DocumentEntry>
	activeTransactions: number
}

// ── Channel messages ─────────────────────────────────────────────────────────

/**
 * ProjectChannelMessage - the public event contract of a Project.
 *
 * Every mutation a Project or one of its Documents performs is announced on a
 * BroadcastChannel named `project.channelName`. Open your own channel instance
 * (`project.createChannel()`) to receive every message, same-tab and cross-tab
 * (the spec only withholds a message from the exact instance that posted it).
 *
 * Payloads are structured-cloneable by construction — they cross the channel.
 * Changing a member of this union is a breaking API change.
 */
export type ProjectChannelMessage =
	| { type: 'commit'; documentId: string; timestamp: number }
	| { type: 'init-empty-document'; documentId: string; timestamp: number }
	| { type: 'document-removed'; documentId: string; timestamp: number }
	| { type: 'document-imported'; documentId: string; timestamp: number }
	| { type: 'blob-added'; blobId: string; documentId: string; timestamp: number }
	| { type: 'blob-attached'; blobId: string; ref: BlobAttachment; timestamp: number }
	| {
			type: 'blob-detached'
			blobId: string
			ref: { documentId: string; recordRef: string }
			timestamp: number
	  }
	| { type: 'blob-removed'; blobId: string; timestamp: number }

// ── Storage ──────────────────────────────────────────────────────────────────

export type StorageParam =
	| { type: 'local' }
	| { type: 'custom'; store: Store }
	| { type: 'inMemory'; writable?: boolean }

// ── Project constructor ──────────────────────────────────────────────────────

export type ProjectParams<
	GenericConfig extends AnyDialecteConfig,
	BaseExtensions extends ExtensionModules = Record<never, never>,
	CustomExtensions extends ExtensionModules = Record<never, never>,
> = {
	/**
	 * Config registry keyed by label.
	 * Single-dialect: { scl: sclConfig }
	 * Multi-dialect: { nsd: nsdConfig, nsdoc: nsdocConfig }
	 */
	configs: Record<string, GenericConfig>
	/** Used when configKey is omitted in createDocument. Defaults to first key. */
	defaultConfigKey?: string
	/** Storage backend. 'local' uses DexieStore; 'custom' brings your own Store. */
	storage: StorageParam
	/** Extensions applied to all Documents opened from this Project */
	extensions?: { base?: BaseExtensions; custom?: CustomExtensions }
	/** All lifecycle hooks (IO + record), applied to every Document opened from this Project */
	hooks?: DialecteHooks<GenericConfig>
	/**
	 * The dialecte the project belongs to (a dialecte's project factory gives it): with the name, which project a
	 * store holds - two dialectes' projects of one name are two projects. Without it, the name alone.
	 */
	dialecteId?: string
}

// ── resolveConfig ────────────────────────────────────────────────────────────────

export type ResolveConfigParams = {
	configs: Record<string, AnyDialecteConfig>
	defaultConfigKey: string
	/** Key into configs registry. Defaults to defaultConfigKey. */
	configKey?: string
}

export type ResolvedConfig = {
	configKey: string
	config: AnyDialecteConfig
}

// ── createDocument ───────────────────────────────────────────────────────────────

export type InitEmptyDocumentOptions = {
	/** Filename without extension. Defaults to the path's file name less its extension, else 'untitled'. */
	name?: string
	/**
	 * File extension including leading dot. Defaults to the path's file name's (one the config reads), else the
	 * config's first supported extension.
	 */
	extension?: string
	/**
	 * Where the document sits in the project (`substations/north.scd`), its file name the document's name and
	 * extension: `DOCUMENT_PATH_INVALID` for a path breaking a rule or naming another file, `DOCUMENT_PATH_TAKEN`
	 * for a place another document holds.
	 */
	path?: string
	/** Key into configs registry. Defaults to defaultConfigKey or first key. */
	configKey?: string
	/** Extensible per-file metadata */
	metadata?: Record<string, unknown>
}

export type InitEmptyDocumentParams = {
	store: Store
	configs: Record<string, AnyDialecteConfig>
	defaultConfigKey: string
	options?: InitEmptyDocumentOptions
	/** Hooks from the Project instance (erased); standardizes the root record */
	hooks?: DialecteHooks<AnyDialecteConfig>
}

export type InitEmptyDocumentResult = {
	documentId: string
	record: DocumentRecord
	documentState: DocumentEntry
}

// ── import ───────────────────────────────────────────────────────────────────

/** How to import a file: what the store is asked to do, and what the caller holds over it. */
export type ImportDocumentOptions = ImportFileOptions & ImportControl

/** How to import several files: as one file, without a path (a path names one file). */
export type ImportFilesOptions = Omit<ImportDocumentOptions, 'path'>

/** A file `Project.importFile` imported: the document it is now, and what the import had to say. */
export type ImportedDocument = {
	/** `file.name` as given */
	fileName: string
	documentId: string
	recordCount: number
	/** Always present, `[]` when the import had nothing to say; an open union, narrowed with `isKnownDiagnostic` */
	diagnostics: Diagnostic[]
}

/**
 * What `Project.import` says of one file: imported, or failed with the structured error - a file's
 * failure is its entry, never the call's.
 */
export type ImportEntry =
	| ({ status: 'imported' } & ImportedDocument)
	| { status: 'failed'; fileName: string; error: DialecteError }

// ── exportDocument ───────────────────────────────────────────────────────────

/** What `Project.export` is asked: the document, its layout, and what to make of it on the page. */
export type ProjectExportParams = {
	documentId: string
	/** The file formatted (4 spaces, CRLF, a text value on its element's line); `false` = compact. Default `true`. */
	indent?: boolean
	/** The record id as `_temp-idb-id` on every element (and in the DOM). Default `false`. */
	withDatabaseIds?: boolean
	/** Also answer the DOM of the document, parsed from the compact file in the page. */
	xmlDocument?: boolean
	/**
	 * Also save the formatted file: the save dialog where the browser has one (asked before the export runs), a
	 * download otherwise; under the document's filename unless one is given.
	 */
	download?: boolean | { filename: string }
}

/** A document `Project.export` exported. */
export type ProjectExportResult = {
	/** The document as UTF-8 XML, in the layout `indent` asked */
	file: Blob
	/** The document's name and extension */
	filename: string
}

/** A document `Project.export` exported with its DOM. */
export type ProjectExportResultWithDocument = ProjectExportResult & { xmlDocument: XMLDocument }

/** A document `Project.export` exported, with its DOM when it was asked. */
export type ProjectExportResultMaybeDocument = ProjectExportResult & { xmlDocument?: XMLDocument }

/** What `exportDocument` runs on: the project's store and state. */
export type ExportDocumentParams = {
	store: Store
	state: ProjectState
	projectName: string
	/** What the project was asked */
	request: ProjectExportParams
	/** The project's perf: the store's export timings are merged into it under `store::` */
	perf?: Perf
}

/** One store export in a layout, its timings merged into the project's perf. */
export type ExportLayoutParams = Pick<ExportDocumentParams, 'store' | 'perf'> & {
	documentId: string
	indent: boolean
	withDatabaseIds: boolean | undefined
}

// ── exportBlob ───────────────────────────────────────────────────────────────

/** What `Project.exportBlob` is asked: the blob, and whether to save it. */
export type ProjectExportBlobParams = {
	blobId: string
	/**
	 * Also save the blob: the save dialog where the browser has one, a download otherwise; under the blob's name
	 * (the dialog opened once the blob is read) or the one given (the dialog opened first). The result's
	 * `filename` stays the blob's own name.
	 */
	download?: boolean | { filename: string }
}

/** What `exportBlob` runs on: the project's store. */
export type ExportBlobParams = {
	store: Store
	request: ProjectExportBlobParams
}

export type ExportBlobResult = {
	entry: BlobRecord
	data: Blob
	filename: string
}
