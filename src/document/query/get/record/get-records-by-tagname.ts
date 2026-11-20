import { readThroughScope } from '../../read-scope/read-through-scope'
import { overlayStaged } from './staged-lookup'

import {
	noteReadsOf,
	readGenerationOf,
	storedRecordsOfTag,
} from '@/document/transaction-read-cache'
import { TRANSACTION_READ_CACHE_PERF } from '@/document/transaction-read-cache.constants'

import type { Context } from '@/document'
import type { AnyDialecteConfig, AnyRawRecord, ElementsOf, RawRecord, TrackedRecord } from '@/types'

/**
 * Fetch all records for a tagName, overlaid with staged operations.
 *
 * DB records are marked 'unchanged'; staged creates/updates/deletes are
 * applied on top by overlayStaged.
 *
 * Side effect: a transaction's read cache holds the tag whole (`noteReadsOf`); a later tag read or value lookup of it
 * in the same transaction is answered from it.
 *
 * @internal the context-level read behind `doc.query.getRecordsByTagName`; callers use the query
 */
export async function getRecordsByTagName<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	tagName: GenericElement
}): Promise<TrackedRecord<GenericConfig, GenericElement>[]> {
	const { context, tagName } = params
	const rawRecords = (await storedRecordsOfTagIn({ context, tagName })) as RawRecord<
		GenericConfig,
		GenericElement
	>[]
	return overlayStaged({ rawRecords, stagedOperations: context.stagedOperations.log, tagName })
}

/**
 * The stored records of a tag, in id order: from a transaction's read cache when the tag was read whole in it, else read
 * from the store (a transaction's cache then holds the tag whole).
 *
 * @internal the stored half of a tag read, and the whole-tag read of a lookup that completes its tag
 */
export async function storedRecordsOfTagIn(params: {
	context: Context<AnyDialecteConfig>
	tagName: string
}): Promise<AnyRawRecord[]> {
	const { context, tagName } = params
	const cache = context.kind === 'transaction' ? context.readCache : undefined
	const held = cache && storedRecordsOfTag({ cache, tagName })
	if (held) {
		context.perf.count(TRANSACTION_READ_CACHE_PERF.hit)
		return held
	}
	const readAt = readGenerationOf({ context })
	const rawRecords = (await readThroughScope({
		context,
		read: { member: 'getByTagNameInDocument', args: [tagName, context.documentId] },
	})) as AnyRawRecord[]
	noteReadsOf({ context, records: rawRecords, readAt, completes: tagName })
	return rawRecords
}
