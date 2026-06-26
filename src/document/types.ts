import type { Query } from './query'
import type { ExtensionsRegistry, QueryExtensions } from './types.extensions'
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
	readonly dialecteConfig: GenericConfig
	readonly documentId: string
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

export type PreparedTransaction<
	GenericConfig extends AnyDialecteConfig,
	GenericExtension extends ExtensionsRegistry = {},
> = {
	readonly operations: ReadonlyArray<Operation<GenericConfig>>
	readonly summary: { creates: number; updates: number; deletes: number }
	/**
	 * Read-only view of the in-progress transaction.
	 *
	 * Typed as `Query` plus the dialecte's **query** extensions, so domain query
	 * methods (e.g. an `SclQuery`'s) appear in intellisense, while transaction
	 * mutations stay hidden by the type (they exist at runtime). Reads overlay
	 * staged ops automatically, so this reflects the hooks-applied, uncommitted
	 * state.
	 *
	 * Valid only BEFORE `commit()`/`discard()` — both clear the staged ops and
	 * record cache, after which the query reads the bare store.
	 */
	readonly query: Query<GenericConfig> & QueryExtensions<GenericExtension>
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
