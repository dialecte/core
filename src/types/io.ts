import type { AnyRawRecord } from './records'

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
 */
export type RecordPatch = { recordId: string } & Partial<Omit<AnyRawRecord, 'id'>>

/**
 * A warning produced during import.
 *
 * `type` is a discriminant string owned by the dialecte (e.g. `'unresolved-reference'`).
 * `recordId` identifies the record that triggered the warning.
 * `details` carries dialecte-specific context — its shape is defined by the dialecte.
 */
export type ImportWarning = {
	type: string
	recordId: string
	details?: Record<string, unknown>
}

/**
 * Return value of the afterImport hook.
 * Core applies each collection in order: creates → updates → deletes.
 */
export type AfterImportResult = {
	/** New records to insert */
	creates?: AnyRawRecord[]
	/** Patches to merge into existing records */
	updates?: RecordPatch[]
	/** IDs of records to remove */
	deletes?: string[]
	/** Warnings collected during resolution — unresolved refs, unknown paths, etc. */
	warnings?: ImportWarning[]
}

/**
 * IO hooks for import/export lifecycle.
 */
export type IOHooks = {
	beforeImportRecord?: (params: { record: AnyRawRecord; ancestry: readonly AnyRawRecord[] }) => void
	/** Returns records to create/update/delete after all records are stored. */
	afterImport?: () => Promise<AfterImportResult>
}
