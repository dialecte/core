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
}

/**
 * IO hooks for import/export lifecycle.
 *
 * - `beforeImportRecord`: called synchronously per record during streaming.
 *   Use to collect data (e.g., build path indexes) without blocking the parser.
 * - `afterImport`: called once after all records are stored.
 *   Use for cross-record resolution (e.g., path → UUID) via bulk writes.
 */
export type IOHooks = {
	beforeImportRecord?: (params: { record: AnyRawRecord; ancestry: readonly AnyRawRecord[] }) => void
	/** Returns records to create/update/delete after all records are stored. */
	afterImport?: () => Promise<AfterImportResult>
}
