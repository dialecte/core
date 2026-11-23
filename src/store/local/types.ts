import { RecordSchema } from '../store.types'

import type { Perf } from '@/perf'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { DocumentRecord } from '@/project/types'

export type DexieStoreOptions = {
	/** Backend-agnostic record schema. Comes from dialecteConfig.recordSchema */
	recordSchema?: RecordSchema
	/** Dev-only perf helper (from the owning Project). Defaults to a no-op. */
	perf?: Perf
	/**
	 * The dialecte the store imports and exports files with; without it, `importFile` throws `IMPORT_FAILED`
	 * and `exportFile` `ASSERTION_FAILED`
	 */
	runtime?: StoreRuntime
}

/** A `_documents` row as stored: one written before 0.7 has no `status`. */
export type StoredDocumentRow = Omit<DocumentRecord, 'status'> &
	Partial<Pick<DocumentRecord, 'status'>>

/** A document's row of the `_versions` table: how many writes it has taken. */
export type DocumentVersionRow = { key: string; count: number }

/** The `_versions` row naming the database's engine: drawn once, kept until the database is destroyed. */
export type EngineVersionRow = { key: string; engineId: string }
