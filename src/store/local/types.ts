import { RecordSchema } from '../store.types'

import type { Perf } from '@/perf'

export type DexieStoreOptions = {
	/** Backend-agnostic record schema. Comes from dialecteConfig.recordSchema */
	recordSchema?: RecordSchema
	/** Dev-only perf helper (from the owning Project). Defaults to a no-op. */
	perf?: Perf
}
