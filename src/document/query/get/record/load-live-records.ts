import { overlayAllStaged } from './staged-lookup'

import type { Context } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/**
 * Read every record of the document once and overlay the staged operations: the in-memory
 * data source of a whole-tree read (`getTree`) and of a descendant collect that has outgrown
 * its climb (`findDescendants`). One `getByDocumentId` round trip, whatever the document size.
 */
export async function loadLiveRecords<GenericConfig extends AnyDialecteConfig>(
	context: Context<GenericConfig>,
): Promise<Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>> {
	context.perf.count('core::store::getByDocumentId')
	const rawRecords = await context.store.getByDocumentId(context.documentId)
	const { live } = overlayAllStaged({
		rawRecords,
		stagedOperations: context.stagedOperations,
	})
	return live as unknown as Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>
}
