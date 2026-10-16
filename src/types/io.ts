import type { AnyRawRecord } from './records'
import type { Diagnostic } from '@/diagnostics'

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
 * The hooks of one file's import. Core creates a session per file (`IOHooks.createImportSession`)
 * and drops it after `afterImport`: whatever state the session keeps between records is that file's
 * only. Typed on the diagnostics it emits so a dialecte's tests check them exactly; the project does
 * not carry the type (a document's diagnostics come from several producers).
 */
export type ImportSession<GenericDiagnostic extends Diagnostic = Diagnostic> = {
	/**
	 * Called once per record as its closing tag is parsed, AFTER the record has
	 * been standardized (attributes canonicalized, `afterStandardizedRecord`
	 * applied). The record is finalized so this hook can index it or collect
	 * reference resolutions without re-implementing standardization. `ancestry`
	 * are the still-open parent records (not yet closed, hence not yet standardized).
	 */
	beforeImportRecord?: (params: { record: AnyRawRecord; ancestry: readonly AnyRawRecord[] }) => void
	/** Called once after all records are stored: the writes to apply and the diagnostics of this file. */
	afterImport?: () => Promise<AfterImportResult<GenericDiagnostic>>
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
