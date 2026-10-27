import type { StoreRuntime } from './store-runtime.types'
import type { Perf } from '@/perf'
import type { ImportTarget } from '@/store/store.types'
import type { ImportFileOptions } from '@/store/store.types'

export type RunImportParams = {
	/** The store the records are written to */
	store: ImportTarget
	runtime: StoreRuntime
	file: File
	options?: ImportFileOptions
	/** The caller's id for this import, kept on the document's registry row */
	writeId: string
	/**
	 * The perf the import's stages are timed on, when the store times its own stages on it too (its
	 * target's writes); one is made from `runtime.perf` when absent. The result carries its snapshot
	 * when `runtime.perf` is on.
	 */
	perf?: Perf
}
