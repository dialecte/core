import {
	COMPLETE_TAG_AT_LOOKUP,
	LARGE_DOCUMENT_RECORDS,
	READ_EPOCH_KEY,
	RECORDS_PER_LOOKUP,
} from './transaction-read-cache.constants'

import { idsByValueOf, idsOfLookup } from '@/utils/ids-by-attribute-value'

import type { CachedTag, TransactionReadCache } from './transaction-read-cache.types'
import type { Context } from './types'
import type { AttributeLookup } from '@/store'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

// The one writer of a transaction's read cache: every function here fills or empties all its maps together, so the
// records by id, the members of each tag and the value indexes built from them never disagree.

/** An empty read cache, for a new transaction. */
export function createTransactionReadCache(): TransactionReadCache {
	return {
		records: new Map(),
		tags: new Map(),
		epoch: undefined,
		documentCount: undefined,
		generation: 0,
	}
}

/** Empty the cache: every record, every tag and what is known of it. */
// dialecte-allow argument-mutation: the transaction's cache is emptied in place, as its record cache always was
export function dropTransactionReadCache(params: { cache: TransactionReadCache }): void {
	const { cache } = params
	cache.records.clear()
	cache.tags.clear()
	cache.documentCount = undefined
	cache.generation += 1
}

/**
 * Before a read: a told change since the cache was filled (the document's read epoch moved) empties it. Without an epoch
 * (a transaction no Document wired) nothing is followed. Not the read scope's `followEpoch`: that one empties one verb
 * call's scope of a query; this one a transaction's cache, and tells whether it dropped it.
 */
// dialecte-allow argument-mutation: the cache notes the epoch it is filled at
export function followReadEpoch(params: {
	cache: TransactionReadCache
	readEpoch: (() => number) | undefined
}): boolean {
	const { cache, readEpoch } = params
	if (!readEpoch) return false
	const epoch = readEpoch()
	const moved = cache.epoch !== undefined && cache.epoch !== epoch
	if (moved) dropTransactionReadCache({ cache })
	cache.epoch = epoch
	return moved
}

/**
 * Note stored records as read: each by id and as a member of its tag; with `completes`, that tag holds no stored record
 * beyond them (a whole-tag read). A record read again with other attributes drops the value indexes of its tag (built
 * again from the records when next asked).
 */
// dialecte-allow argument-mutation: a transaction's cache is filled by its reads
export function noteStoredRecords(params: {
	cache: TransactionReadCache
	records: readonly AnyRawRecord[]
	completes?: string
}): void {
	const { cache, records, completes } = params
	for (const record of records) {
		const held = cache.records.get(record.id)
		cache.records.set(record.id, record)
		const tag = tagOf({ cache, tagName: record.tagName })
		tag.ids.add(record.id)
		if (held && held.attributes !== record.attributes) tag.byAttribute.clear()
	}
	if (completes !== undefined) tagOf({ cache, tagName: completes }).complete = true
}

/** Count one value lookup of a tag the store answers; the count so far. */
export function noteLookup(params: { cache: TransactionReadCache; tagName: string }): number {
	const tag = tagOf(params)
	tag.lookups += 1
	return tag.lookups
}

/**
 * The lookup of a tag at which it is read whole, for a document of `documentCount` records: `COMPLETE_TAG_AT_LOOKUP`, or
 * for a document above `LARGE_DOCUMENT_RECORDS` records, the lookups that cost about what reading that many records does.
 */
export function completionThresholdOf(params: { documentCount: number }): number {
	const { documentCount } = params
	if (documentCount <= LARGE_DOCUMENT_RECORDS) return COMPLETE_TAG_AT_LOOKUP
	return Math.max(COMPLETE_TAG_AT_LOOKUP, Math.ceil(documentCount / RECORDS_PER_LOOKUP))
}

/** Whether a tag was read whole since the cache was last emptied. */
export function isTagComplete(params: { cache: TransactionReadCache; tagName: string }): boolean {
	return params.cache.tags.get(params.tagName)?.complete === true
}

/** The stored records of a complete tag, in id order, from the cache only; `undefined` when the tag is not complete. */
export function storedRecordsOfTag(params: {
	cache: TransactionReadCache
	tagName: string
}): AnyRawRecord[] | undefined {
	const { cache, tagName } = params
	const tag = cache.tags.get(tagName)
	if (!tag?.complete) return undefined
	return recordsOf({ cache, ids: [...tag.ids].sort() })
}

/**
 * What the store's attribute lookup answers, from a complete tag: the records holding, for every entry, an attribute of
 * its name with one of its values, in id order; `undefined` when the tag is not complete. Each attribute's value index is
 * built from the tag's records the first time it is asked.
 */
export function storedAnswerOfLookup(params: {
	cache: TransactionReadCache
	tagName: string
	attributes: AttributeLookup['attributes']
}): AnyRawRecord[] | undefined {
	const { cache, tagName, attributes } = params
	const tag = cache.tags.get(tagName)
	if (!tag?.complete) return undefined
	const ids = idsOfLookup({
		attributes,
		byValueOf: function valueIndexOf(name) {
			const byValue =
				tag.byAttribute.get(name) ?? idsByValueOf({ ids: tag.ids, byId: cache.records, name })
			tag.byAttribute.set(name, byValue)
			return byValue
		},
	})
	return recordsOf({ cache, ids })
}

/** What the cache knows of a tag, made empty the first time it is asked. */
// dialecte-allow argument-mutation: the tag's entry is made in the cache
function tagOf(params: { cache: TransactionReadCache; tagName: string }): CachedTag {
	const { cache, tagName } = params
	const known = cache.tags.get(tagName)
	if (known) return known
	const tag: CachedTag = { ids: new Set(), complete: false, lookups: 0, byAttribute: new Map() }
	cache.tags.set(tagName, tag)
	return tag
}

/** The records of `ids`, as held. */
function recordsOf(params: {
	cache: TransactionReadCache
	ids: readonly string[]
}): AnyRawRecord[] {
	const { cache, ids } = params
	return ids.flatMap(function recordOf(id) {
		const record = cache.records.get(id)
		return record ? [record] : []
	})
}

/**
 * The read cache's generation for a read about to start on `context` (`noteReadsOf`'s `readAt`); `undefined` for a
 * context without a read cache.
 */
export function readGenerationOf(params: {
	context: Context<AnyDialecteConfig>
}): number | undefined {
	const { context } = params
	return context.kind === 'transaction' ? context.readCache?.generation : undefined
}

/**
 * Note stored records a read of `context` answered, when it is a transaction's: through its read cache, or into the
 * plain record cache of a context made without one. A query's context keeps nothing. A read whose cache was emptied
 * while it was in flight (`readAt`, taken with `readGenerationOf` before it started) keeps nothing either: its answer
 * may be from before a told change. `singletonKey` also keeps the first record under that key (a singleton read by tag).
 */
// dialecte-allow argument-mutation: a transaction's cache is filled by its reads
export function noteReadsOf(params: {
	context: Context<AnyDialecteConfig>
	records: readonly AnyRawRecord[]
	readAt: number | undefined
	completes?: string
	singletonKey?: string
}): void {
	const { context, records, readAt, completes, singletonKey } = params
	if (context.kind !== 'transaction') return
	const cache = context.readCache
	if (cache && cache.generation !== readAt) return
	if (cache) noteStoredRecords({ cache, records, completes })
	else for (const record of records) context.recordCache.set(record.id, record)
	if (singletonKey && records[0]) context.recordCache.set(singletonKey, records[0])
}

/**
 * Give a transaction its document's read epoch: a change told on the project channel (another view's commit, an undo,
 * a reimport) then empties the transaction's read cache before its next read. Carried under a symbol, off the
 * transaction's public surface.
 *
 * @internal Used by Document as it makes a transaction.
 */
export function wireReadEpoch(params: { transaction: object; readEpoch: () => number }): void {
	Object.defineProperty(params.transaction, READ_EPOCH_KEY, {
		value: params.readEpoch,
		enumerable: false,
		writable: true,
		configurable: true,
	})
}

/** The read epoch wired into a transaction, `undefined` when no Document wired one. */
export function readEpochOf(transaction: object): (() => number) | undefined {
	return Reflect.get(transaction, READ_EPOCH_KEY) as (() => number) | undefined
}
