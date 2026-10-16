import { RecordSchema } from '../store.types'

import type { Perf } from '@/perf'
import type { DocumentRecord } from '@/project/types'

export type DexieStoreOptions = {
	/** Backend-agnostic record schema. Comes from dialecteConfig.recordSchema */
	recordSchema?: RecordSchema
	/** Dev-only perf helper (from the owning Project). Defaults to a no-op. */
	perf?: Perf
}

/** A `_documents` row as stored: one written before 0.7 has no `status`. */
export type StoredDocumentRow = Omit<DocumentRecord, 'status'> &
	Partial<Pick<DocumentRecord, 'status'>>
