import type { DocumentState, ExtensionModules } from '@/document'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig, ChunkOptions, TransactionHooks } from '@/types'

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
}

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

// ── Storage ──────────────────────────────────────────────────────────────────

export type StorageParam = { type: 'local' } | { type: 'custom'; store: Store }

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
	/** Transaction hooks applied to all Documents */
	hooks?: TransactionHooks<GenericConfig>
}

// ── createDocument ───────────────────────────────────────────────────────────────

export type InitEmptyDocumentOptions = {
	/** Filename without extension. Defaults to 'untitled'. */
	name?: string
	/** File extension including leading dot. Defaults to config's first supported extension. */
	extension?: string
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
}

export type InitEmptyDocumentResult = {
	documentId: string
	record: DocumentRecord
	documentState: DocumentEntry
}

// ── importDocument ───────────────────────────────────────────────────────────────

export type ImportDocumentOptions = {
	/** Key into configs registry. Defaults to defaultConfigKey. */
	configKey?: string
	/** Extensible per-file metadata */
	metadata?: Record<string, unknown>
	/** Override chunking defaults for SAX streaming */
	chunkOptions?: Partial<ChunkOptions>
	/** Use custom record IDs from XML attributes instead of generating UUIDs */
	useCustomRecordsIds?: boolean
}

export type ImportDocumentParams = {
	file: File
	store: Store
	configs: Record<string, AnyDialecteConfig>
	defaultConfigKey: string
	options?: ImportDocumentOptions
}

export type ImportDocumentResult = {
	documentId: string
	record: DocumentRecord
	documentState: DocumentEntry
	recordCount: number
}

// ── exportDocument ───────────────────────────────────────────────────────────

export type ExportDocumentParams = {
	documentId: string
	state: ProjectState
	configs: Record<string, AnyDialecteConfig>
	store: Store
	projectName: string
	options?: ExportDocumentOptions
}

export type ExportDocumentOptions = {
	/** Include internal database IDs in exported XML */
	withDatabaseIds?: boolean
	/** Trigger a browser file download after export */
	withDownload?: boolean
}

export type ExportDocumentResult = {
	xmlDocument: XMLDocument
	filename: string
}
