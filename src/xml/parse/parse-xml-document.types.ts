import type { Perf } from '@/perf'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig, ChunkOptions, DialecteHooks } from '@/types'

export type ParseXmlFileParams = {
	file: File
	documentId: string
	store: Store
	config: AnyDialecteConfig
	/** Use custom record IDs from XML attributes (testing) */
	useCustomRecordsIds?: boolean
	/** Override chunking defaults */
	chunkOptions?: Partial<ChunkOptions>
	/** Project hooks (erased): io hooks + afterStandardizedRecord for import */
	hooks?: DialecteHooks<AnyDialecteConfig>
	/** Dev perf helper (shared project instance); defaults to a no-op. */
	perf?: Perf
}

export type ParseXmlFileResult = {
	documentId: string
	recordCount: number
}
