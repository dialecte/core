import type { Diagnostic } from '@/diagnostics'
import type { Perf } from '@/perf'
import type { ImportReporter } from '@/store/import-progress/import-progress.types'
import type { ImportTarget } from '@/store/store.types'
import type { AnyDialecteConfig, ChunkOptions, DialecteHooks } from '@/types'

/**
 * What the parse writes through: the file's records, then its session's writes; registering the document and marking
 * it ready are its caller's.
 */
export type ParseTarget = Pick<ImportTarget, 'bulkWrite' | 'writeSession'>

export type ParseXmlFileParams = {
	file: File
	documentId: string
	/** The key the config is registered under; given to the import session */
	configKey: string
	store: ParseTarget
	config: AnyDialecteConfig
	/** Use custom record IDs from XML attributes (testing) */
	useCustomRecordsIds?: boolean
	/** Override chunking defaults */
	chunkOptions?: Partial<ChunkOptions>
	/** Project hooks (erased): io hooks + afterStandardizedRecord for import */
	hooks?: DialecteHooks<AnyDialecteConfig>
	/** Dev perf helper (shared project instance); defaults to a no-op. */
	perf?: Perf
	/** Where the file's import tells its progress; one made over `control.onProgress` when absent */
	reporter?: ImportReporter
}

export type ParseXmlFileResult = {
	documentId: string
	recordCount: number
	/** What the import session had to say; `[]` when nothing */
	diagnostics: Diagnostic[]
}
