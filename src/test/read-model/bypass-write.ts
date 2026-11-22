import type { Store } from '@/store/store.types'
import type { AnyRawRecord } from '@/types'

/**
 * Commits a change to a document through a store held directly: it lands like any commit, but no project makes it, so
 * no project tells it (a store that announces still tells its connections).
 *
 * @intent write around a project in a test
 */
export async function writeAround(params: {
	store: Store
	documentId: string
	updates?: AnyRawRecord[]
	creates?: AnyRawRecord[]
}): Promise<void> {
	const { store, documentId, updates = [], creates = [] } = params
	await store.commit({
		documentId,
		writeId: crypto.randomUUID(),
		creates,
		updates,
		deletes: [],
		onProgress: function ignoreProgress() {},
	})
}
