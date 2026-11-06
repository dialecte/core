import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/**
 * What a store imports and exports with: the dialecte's configs and its hooks, held next to the data (a store
 * behind a worker holds its own; a store on the page shares the project's).
 */
export type StoreRuntime = {
	configs: Record<string, AnyDialecteConfig>
	defaultConfigKey: string
	/** IO hooks (`beforeImport`, `createImportSession`) and the record hooks standardization applies */
	hooks?: DialecteHooks<AnyDialecteConfig>
	/** Measure the import's and the export's stages: each result then carries the run's perf snapshot */
	perf?: boolean
	/** The version of the dialecte: the engine a store starts or reaches runs that version (SQLite). */
	dialecteVersion?: string
}
