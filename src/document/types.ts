import type { Document } from './document'
import type { ProgressReporter, DocumentProgress } from './progress/progress.types'
import type { Query } from './query'
import type { ReadScope } from './query/read-scope/read-scope.types'
import type { TransactionReadCache } from './transaction-read-cache.types'
import type { OperationsSummary } from './transaction/commit/summarize-operations.types'
import type { ExtensionsRegistry, QueryExtensions } from './types.extensions'
import type { ExtensionModules, MergedExtensions } from './types.extensions'
import type { DialecteError } from '@/errors'
import type { Perf } from '@/perf'
import type { Store } from '@/store'
import type { AnyDialecteConfig, Operation, AnyRawRecord } from '@/types'

/**
 * The document a project configured with `GenericModules` yields — i.e. the
 * return type of `Project<Config, Modules>['openDocument']`. Both the query
 * surface and the transaction callback are typed through the extension system.
 *
 * This is the single source of truth for "a `Document` augmented with modules".
 * Config packages hydrate it into a one-parameter helper by fixing the config
 * and pre-merging their base modules, e.g.
 * `type ExtendedDocument<Custom> = Core.ExtendedDocument<Config, BaseModules & Custom>`.
 */
export type ExtendedDocument<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules,
> = Document<GenericConfig, MergedExtensions<GenericModules>>

/**
 * Staged writes of a transaction.
 *
 * `log` is the ordered write history — the source of truth for commit merge,
 * overlay, and the id-less singleton scan. `byId`, `byAttribute` and `appended`
 * are derived indexes (the latest operation per id, its attribute values, its
 * place after a tag's stored records), all written by `recordStagedOperation`
 * only, so they can never desync.
 */
export type StagedOperations<GenericConfig extends AnyDialecteConfig> = {
	log: Operation<GenericConfig>[]
	byId: Map<string, Operation<GenericConfig>>
	/** The attribute values of the records staged as created or updated, by their last operation. */
	byAttribute: StagedAttributeIndex
	/**
	 * Where a tag read puts each id after the store's records of the tag, as replaying the log does: a create of an id
	 * not staged before, or a write after a staged delete, takes the next place; an update of a stored record takes
	 * none (it keeps the store's place); a delete removes the id's place.
	 */
	appended: Map<string, number>
}

/** The ids whose last staged operation holds a record of that tag with that attribute value: tag -> name -> value -> ids. */
export type StagedAttributeIndex = Map<string, Map<string, Map<string, Set<string>>>>

/** What every context of the query layer carries. */
type ContextBase<GenericConfig extends AnyDialecteConfig> = {
	readonly store: Store
	readonly dialecteConfig: GenericConfig
	readonly documentId: string
	readonly stagedOperations: StagedOperations<GenericConfig>
	readonly progress: ProgressReporter
	readonly perf: Perf
}

/**
 * A Query's context: no record cache, and the read scope of the public verb call it runs in, if any (repeated store
 * reads inside one call answered from it; see `readThroughScope`).
 */
export type QueryContext<GenericConfig extends AnyDialecteConfig> = ContextBase<GenericConfig> & {
	readonly kind: 'query'
	readonly recordCache: undefined
	readonly readScope: ReadScope | undefined
}

/**
 * A Transaction's context: its record cache, never a read scope (a transaction reads its own staged state).
 * Use isTransactionContext() to narrow before cache reads/writes.
 *
 * A Transaction's context carries its read cache (`readCache`, see `transaction-read-cache.ts`): `recordCache` is that
 * cache's records by id, read here and written through the cache's entry point only. A context made without one (a
 * test's) keeps a plain record cache: its tags are never read whole.
 */
export type CachedContext<GenericConfig extends AnyDialecteConfig> = ContextBase<GenericConfig> & {
	readonly kind: 'transaction'
	readonly recordCache: Map<string, AnyRawRecord>
	readonly readCache?: TransactionReadCache
	readonly readScope?: undefined
}

/**
 * Context passed to methods.
 *
 * Owned and built by Query (or Transaction), exposed as `this.context` for subclasses.
 */
export type Context<GenericConfig extends AnyDialecteConfig> =
	| QueryContext<GenericConfig>
	| CachedContext<GenericConfig>

//== Document types

export type PreparedTransaction<
	GenericConfig extends AnyDialecteConfig,
	GenericExtension extends ExtensionsRegistry = {},
> = {
	readonly operations: ReadonlyArray<Operation<GenericConfig>>
	/** One count per record, as the commit merges the operations: totals and per tag. */
	readonly summary: OperationsSummary
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
	progress: DocumentProgress

	/** Breadcrumb trail — what happened in order (debugging) */
	history: TransactionEntry[]

	/**
	 * Timestamp of the last successful update (local or remote).
	 * Watch this field in the UI to know when to refetch data.
	 * null until the first update completes.
	 */
	lastUpdate: number | null
}
