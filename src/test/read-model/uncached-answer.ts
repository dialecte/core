import { Query } from '@/document'

import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

/**
 * What a read answers with no cache at all: `read` runs on a query over `store` that no document wired, so no read
 * scope opens and nothing is kept.
 *
 * @intent read without any cache in a test, compare a read cache with the uncached path
 */
export async function answerUncached<
	GenericAnswer,
	GenericConfig extends AnyDialecteConfig = AnyDialecteConfig,
>(params: {
	store: Store
	config: GenericConfig
	documentId: string
	read: (query: Query<GenericConfig>) => Promise<GenericAnswer>
}): Promise<GenericAnswer> {
	const { store, config, documentId, read } = params
	return read(new Query<GenericConfig>(store, config, documentId))
}
