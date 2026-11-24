import { RecordSchema } from '../store.types'

import type { ChangeLogEntry, StoreVersion } from '../store.types'
import type { Perf } from '@/perf'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { DocumentRecord } from '@/project/types'
import type Dexie from 'dexie'

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

/** The `_meta` row naming the database's engine: drawn once, kept until the database is destroyed. */
export type EngineMetaRow = { key: string; engineId: string }

/** What `DexieStore`'s write transaction is asked: the tables beside the record one, what runs in it, and its retry. */
export type WriteTransactionParams<GenericAnswer> = {
	/** The document whose record table is in the transaction too, refused when the connection does not hold it */
	documentId?: string
	tables: string[]
	run: (db: Dexie) => Promise<GenericAnswer>
	/** What a document the connection does not hold answers, instead of a refusal */
	onUnregistered?: () => GenericAnswer
	/** Set on the one run after a connection closed under the first */
	retried?: boolean
}

/** One step of a document's history applied: the entry's operations, and the version the step produced. */
export type SteppedHistory = { operations: ChangeLogEntry['operations']; version: StoreVersion }
