import { CachedContext, Context } from '../types'

import { AnyDialecteConfig } from '@/types'

/**
 * Whether a context is a transaction's (its `kind`), narrowing it to `CachedContext`.
 *
 * @internal context check of the query layer
 */
export function isTransactionContext<GenericConfig extends AnyDialecteConfig>(
	context: Context<GenericConfig>,
): context is CachedContext<GenericConfig> {
	return context.kind === 'transaction'
}
