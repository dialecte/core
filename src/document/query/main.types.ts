import type { Store } from '@/store'
import type { AnyDialecteConfig, Operation, AnyRawRecord } from '@/types'

/**
 * Read-only context passed to record FP functions.
 *
 * Owned and built by Query, exposed as `this.context` for subclasses.
 * recordCache is only present inside a Transaction — Query passes undefined
 * so reads always hit the store directly (no staleness risk).
 */
export type Context<GenericConfig extends AnyDialecteConfig> = {
	readonly store: Store
	readonly recordCache: Map<string, AnyRawRecord> | undefined
	stagedOperations: Operation<GenericConfig>[]
}

/**
 * Narrowed Context that has an active cache — only true inside a Transaction.
 * Use isTransactionContext() to narrow before cache reads/writes.
 */
export type CachedContext<GenericConfig extends AnyDialecteConfig> = Context<GenericConfig> & {
	readonly recordCache: Map<string, AnyRawRecord>
}
