import { STORE_RUNTIME_REFUSALS } from './store-runtime.constants'

import { throwDialecteError } from '@/errors'

import type { StoreRuntime } from './store-runtime.types'

/**
 * The dialecte a store imports and exports with; a store built without one refuses: an import with
 * `IMPORT_FAILED`, an export with `ASSERTION_FAILED` (it cannot write XML without the dialecte's configs).
 */
export function requireStoreRuntime(params: {
	runtime: StoreRuntime | undefined
	storeName: string
	operation: keyof typeof STORE_RUNTIME_REFUSALS
}): StoreRuntime {
	const { runtime, storeName, operation } = params
	if (!runtime) {
		throwDialecteError(STORE_RUNTIME_REFUSALS[operation], {
			detail: `Store "${storeName}" has no dialecte to ${operation} with: build it with a runtime`,
		})
	}
	return runtime
}
