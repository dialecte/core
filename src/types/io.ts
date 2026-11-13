import type { AnyRawRecord } from './records'
import type { Diagnostic } from '@/diagnostics'
import type { ImportStepReport } from '@/store/store.types'

/**
 * Options for chunking during import/export
 */
export type ChunkOptions = {
	batchSize: number
	chunkSize: number
}

/**
 * Options for importing XML files
 */
export type ImportOptions = ChunkOptions & {
	useBrowserApi: boolean
}

export type ExportOptions = {
	useBrowserApi: boolean
}

/**
 * A partial update to apply to an existing record.
 * Any field except `id` can be patched. For `attributes`, values are merged
 * by attribute name (existing attributes are updated, new ones appended).
 * `removeAttributes` names attributes to drop; it is applied after the merge,
 * so an attribute both set and removed by the same patch ends up removed.
 */
export type RecordPatch = { recordId: string } & Partial<Omit<AnyRawRecord, 'id'>> & {
		removeAttributes?: readonly string[]
	}

/**
 * What an import session gives back once the last record is stored.
 * Core applies each collection in order: creates → updates → deletes; the diagnostics are returned
 * to the caller of the import with the document.
 */
export type AfterImportResult<GenericDiagnostic extends Diagnostic = Diagnostic> = {
	/** New records to insert */
	creates?: AnyRawRecord[]
	/** Patches to merge into existing records */
	updates?: RecordPatch[]
	/** IDs of records to remove */
	deletes?: string[]
	/** What the import has to say about the file - unresolved references, values rewritten, … */
	diagnostics?: GenericDiagnostic[]
}

/**
 * What core hands `afterImport`: where it reports its steps, and the import's abort.
 */
export type AfterImportContext = {
	/**
	 * Tell a step and how far it is (`done` out of `total` when it holds a count): the import's `processing`
	 * progress. Core keeps at most one report per `IMPORT_PROGRESS_INTERVAL_MS` (the last of each step always told),
	 * so a long loop may report every item; never throws, ignored once the import is aborted.
	 */
	report: (step: ImportStepReport) => void
	/**
	 * Aborted when the caller aborts the import: the hook stops between its steps (return or throw, it does not
	 * matter), core throws `IMPORT_ABORTED` and keeps nothing of the file.
	 */
	signal: AbortSignal
}

/**
 * The hooks of one file's import. Core creates a session per file (`IOHooks.createImportSession`)
 * and drops it after `afterImport`: whatever state the session keeps between records is that file's
 * only. Typed on the diagnostics it emits so a dialecte's tests check them exactly; the project does
 * not carry the type (a document's diagnostics come from several producers).
 */
export type ImportSession<GenericDiagnostic extends Diagnostic = Diagnostic> = {
	/**
	 * The tag names whose records `beforeImportRecord` is handed; absent, every record is. A record of
	 * another tag passes the session by, its ancestry not built for it: the cheaper the fewer tags.
	 */
	recordTagNames?: readonly string[]
	/**
	 * Called once per record as its closing tag is parsed, AFTER the record has
	 * been standardized (attributes canonicalized, `afterStandardizedRecord`
	 * applied). The record is finalized so this hook can index it or collect
	 * reference resolutions without re-implementing standardization. `ancestry`
	 * are the still-open parent records (not yet closed, hence not yet standardized).
	 */
	beforeImportRecord?: (params: { record: AnyRawRecord; ancestry: readonly AnyRawRecord[] }) => void
	/**
	 * Called once after all records are stored: the writes to apply and the diagnostics of this file. Its context
	 * reports its steps and carries the abort; a hook that takes no argument works as before.
	 */
	afterImport?: (context: AfterImportContext) => Promise<AfterImportResult<GenericDiagnostic>>
}

/**
 * IO hooks for import/export lifecycle.
 */
export type IOHooks = {
	/**
	 * Called once with the raw XML string before any parsing begins.
	 * Return a (possibly modified) XML string. Useful for pre-parse normalization,
	 * e.g. transforming a legacy schema to the canonical form expected by this config.
	 */
	beforeImport?: (xml: string) => string
	/** Called once per file imported; the session it returns lives for that file only. */
	createImportSession?: (params: { documentId: string; configKey: string }) => ImportSession
}
