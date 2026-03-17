import type { DialecteError } from '@/errors'
import type { Store } from '@/store'
import type { AnyDialecteConfig, Operation, AnyRawRecord } from '@/types'

/**
 * Context passed to methods.
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

//== Document types

export type PreparedTransaction<GenericConfig extends AnyDialecteConfig> = {
	readonly operations: ReadonlyArray<Operation<GenericConfig>>
	readonly summary: { creates: number; updates: number; deletes: number }
	commit(): Promise<void>
	discard(): void
}

//== State types

export type TransactionEntry = {
	method: string
	message: string
	timestamp: number
	ref?: { tagName: string; id: string }
}

/**
 * Single observable state for a Document.
 * In Vue: reactive(doc.state) makes all fields trigger re-renders.
 *
 * Usage: const { loading, error, progress } = doc.state
 */
export type DocumentState = {
	loading: boolean
	error: DialecteError | null

	/** Drives progress bars and status messages (commit, deepClone, bulk ops) */
	progress: {
		message: string
		current: number
		total: number
	} | null

	/** Breadcrumb trail — what happened in order (debugging) */
	history: TransactionEntry[]

	/**
	 * Timestamp of the last successful update (local or remote).
	 * Watch this field in the UI to know when to refetch data.
	 * null until the first update completes.
	 */
	lastUpdate: number | null
}
