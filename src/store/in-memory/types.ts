import type { ImportRuntime } from '@/project/io/run-import.types'

export type InMemoryStoreOptions = {
	/** When false, mutations throw STORE_NOT_WRITABLE. Default: true */
	writable?: boolean
	/** The dialecte the store imports files with; without it, `importFile` throws `IMPORT_FAILED` */
	importRuntime?: ImportRuntime
}
