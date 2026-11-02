import type { StagedOperations } from './types'
import type { AnyDialecteConfig } from '@/types'

/**
 * Fresh empty staged-operations container (ordered log + derived by-id index).
 *
 * @internal the empty container a transaction stages its writes in; created by Document
 */
export function createStagedOperations<
	GenericConfig extends AnyDialecteConfig,
>(): StagedOperations<GenericConfig> {
	return { log: [], byId: new Map() }
}
