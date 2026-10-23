import type { Store } from '@/store/store.types'
import type { ImportFileOptions } from '@/store/store.types'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/**
 * What a store imports with: the dialecte's configs and its hooks, held next to the data (a store
 * behind a worker holds its own; a store on the page shares the project's).
 */
export type ImportRuntime = {
	configs: Record<string, AnyDialecteConfig>
	defaultConfigKey: string
	/** IO hooks (`beforeImport`, `createImportSession`) and the record hooks standardization applies */
	hooks?: DialecteHooks<AnyDialecteConfig>
	/** Measure the import's stages: each result then carries the run's perf snapshot */
	perf?: boolean
}

export type RunImportParams = {
	/** The store the records are written to */
	store: Store
	runtime: ImportRuntime
	file: File
	options?: ImportFileOptions
	/** The caller's id for this import, kept on the document's registry row */
	writeId: string
}
