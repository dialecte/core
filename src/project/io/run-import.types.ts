import type { StoreRuntime } from './store-runtime.types'
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
}
