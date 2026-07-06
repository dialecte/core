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
}

export type ParseXmlFileResult = {
	documentId: string
	recordCount: number
}
