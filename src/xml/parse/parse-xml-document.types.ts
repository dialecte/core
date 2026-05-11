import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig, ChunkOptions } from '@/types'

export type ParseXmlFileParams = {
	file: File
	documentId: string
	store: Store
	config: AnyDialecteConfig
	/** Use custom record IDs from XML attributes (testing) */
	useCustomRecordsIds?: boolean
	/** Override chunking defaults */
	chunkOptions?: Partial<ChunkOptions>
}

export type ParseXmlFileResult = {
	documentId: string
	recordCount: number
}
