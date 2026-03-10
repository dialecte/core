import { overlayStaged } from './staged-lookup'

import { isTransactionContext } from '@/document'

import type { Context } from '@/document'
import type { AnyDialecteConfig, ElementsOf, RawRecord, TrackedRecord } from '@/types'

/**
 * Fetch all records for a tagName, overlaid with staged operations.
 *
 * DB records are marked 'unchanged'; staged creates/updates/deletes are
 * applied on top by overlayStaged.
 *
 * Side effect: populates context.recordCache for all fetched DB records.
 */
export async function getRecordsByTagName<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	tagName: GenericElement
}): Promise<TrackedRecord<GenericConfig, GenericElement>[]> {
	const { context, tagName } = params
	const rawRecords = (await context.store.getByTagName(tagName)) as RawRecord<
		GenericConfig,
		GenericElement
	>[]

	for (const record of rawRecords) {
		if (isTransactionContext(context)) context.recordCache.set(record.id, record)
	}

	return overlayStaged({ rawRecords, stagedOperations: context.stagedOperations, tagName })
}
