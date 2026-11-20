/**
 * The value lookup of a tag, in one transaction, at which the tag is read whole and its later lookups are answered from
 * memory: a transaction asking a tag fewer times makes one store call per lookup, as before. On a 59,000-record
 * document a whole read of a looked-up tag cost 0.1-30 ms against about 1 ms per lookup (SQLite, in process).
 */
export const COMPLETE_TAG_AT_LOOKUP = 8

/** Above this many records a document completes a tag later: at `documentCount / RECORDS_PER_LOOKUP` lookups. */
export const LARGE_DOCUMENT_RECORDS = 250_000

/** About how many records a whole-tag read moves for the cost of one value lookup (~5 us a record, ~1 ms a lookup, measured). */
export const RECORDS_PER_LOOKUP = 2_000

/** The perf counts of the transaction read cache. */
export const TRANSACTION_READ_CACHE_PERF = {
	/** A value lookup or a tag read answered from a complete tag. */
	hit: 'core::transaction::readCache.hit',
	/** A tag read whole to answer its lookups from memory. */
	complete: 'core::transaction::readCache.complete',
	/** The cache emptied: the document's read epoch moved. */
	dropped: 'core::transaction::readCache.dropped',
} as const

/** Where a transaction carries its document's read epoch (`wireReadEpoch`): off its public surface. */
export const READ_EPOCH_KEY = Symbol('dialecte.transactionReadEpoch')
