import { CachedContext, Context } from '../types'

import { AnyDialecteConfig } from '@/types'

export function isTransactionContext<GenericConfig extends AnyDialecteConfig>(
	context: Context<GenericConfig>,
): context is CachedContext<GenericConfig> {
	return context.recordCache !== undefined
}
