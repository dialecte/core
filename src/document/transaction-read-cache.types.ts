import type { AnyRawRecord } from '@/types'

/**
 * The stored records a transaction read, kept for it until it ends or a told change (its document's read epoch moves):
 * by id (`records`, the transaction's `recordCache`), and by tag (`tags`). Filled and emptied through
 * `transaction-read-cache.ts` only, so its maps never disagree.
 */
export type TransactionReadCache = {
	/** Layer 1: the stored records read, by id (a singleton also under `__singleton_<tagName>`). */
	readonly records: Map<string, AnyRawRecord>
	/** Layers 2 and 3: what is known of each tag read. */
	readonly tags: Map<string, CachedTag>
	/** The document's read epoch the cache was filled at; `undefined` before any read. */
	epoch: number | undefined
	/** The document's record count, read once, the first time a tag is to be completed. */
	documentCount: number | undefined
	/**
	 * How many times the cache was emptied: a read notes its answer only when no drop happened while it was in flight
	 * (an answer read before a told change is handed back, never kept).
	 */
	generation: number
	/** The whole-tag reads in flight, by tag: lookups that reach the threshold together wait for the one read. */
	readonly completions: Map<string, Promise<void>>
	/** The record count read in flight, once per transaction: lookups past the threshold together wait for it. */
	documentCountRead: Promise<number> | undefined
}

/** What a transaction knows of one tag's stored records. */
export type CachedTag = {
	/** Layer 2: the ids of the tag's stored records read so far. */
	readonly ids: Set<string>
	/** Every stored record of the tag is in `ids`: set by a whole-tag read only. */
	complete: boolean
	/** `ids` in id order, kept until an id is added. */
	sorted: string[] | undefined
	/** The value lookups of the tag the store answered in this transaction. */
	lookups: number
	/** Layer 3: per attribute name, the ids holding each value; built from layer 1 when a complete tag is first asked. */
	readonly byAttribute: Map<string, Map<string, Set<string>>>
}
