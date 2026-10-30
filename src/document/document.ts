import { bindExtensions } from './bind-extensions'
import { Query } from './query'
import { Transaction } from './transaction'
import { summarizeOperations } from './transaction/commit/summarize-operations'

import { createDialecteError, throwDialecteError, toDialecteError } from '@/errors'

import type { PreparedTransaction, DocumentState } from './types'
import type { AllExtensions, ExtensionsRegistry, QueryExtensions } from './types.extensions'
import type { Perf } from '@/perf'
import type { ProjectChannelMessage } from '@/project/types'
import type { Store } from '@/store'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/**
 * Document — the public entry point for querying and mutating a dialecte.
 *
 * Queries: doc.query.getRoot(), doc.query.findChildren(...), etc.
 * Mutations: doc.transaction(async (tx) => { tx.addChild(...) })
 *
 * Single observable state: doc.state — loading, error, progress, history.
 * Transaction mutates this state directly (no separate transaction state).
 *
 * Subclass in a dialecte to override createQuery() / createTransaction()
 * and return domain-specific subclasses (e.g. SclQuery, SclTransaction).
 */
export class Document<
	GenericConfig extends AnyDialecteConfig,
	GenericExtension extends ExtensionsRegistry = {},
> {
	protected store: Store
	protected config: GenericConfig
	protected hooks: DialecteHooks<GenericConfig> | undefined
	readonly documentId: string
	private extensionsRegistry?: GenericExtension

	/**
	 * Observable state, shared with the owning Project's DocumentEntry.
	 * Every Document instance opened for the same documentId mutates the same
	 * object, so commits (local or folded in from other tabs by the Project)
	 * are visible to all of them without any same-tab messaging.
	 */
	readonly state: DocumentState

	/**
	 * Name of the project's BroadcastChannel. Open your own instance
	 * (`new BroadcastChannel(doc.channelName)`) to receive ProjectChannelMessage
	 * events for this project, same-tab and cross-tab.
	 */
	readonly channelName: string

	/** Announce a mutation on the project channel (provided by the owning Project) */
	private broadcast: (message: ProjectChannelMessage) => void

	/** Project-lived dev perf helper (shared instance; no-op unless `dev.perf`). */
	readonly perf: Perf

	/**
	 * Register a callback fired (synchronously, same-realm) whenever this document's
	 * shared state changes: progress steps + loading toggles during a transaction,
	 * undo/redo, and folded-in cross-realm commits. `terminal` is `true` for the
	 * final frame of an operation, letting a consumer flush it without coalescing.
	 * Returns an unsubscribe function. Wired from the owning Project's registry.
	 *
	 * @intent react to document changes in a UI, refresh a view after a commit or an undo, follow transaction progress
	 */
	readonly subscribe: (callback: (terminal: boolean) => void) => () => void

	/** Wake this document's subscribers (provided by the owning Project). */
	private signalStateChange: (terminal: boolean) => void

	/**
	 * Recompute this document's canUndo/canRedo on the shared project entry
	 * (provided by the owning Project). Called locally after a commit so the
	 * flags are up to date synchronously, without depending on a channel echo.
	 */
	private refreshHistoryStatus: () => Promise<void>

	/**
	 * Count a write of this Document (a transaction, a prepared commit) with the owning Project until the
	 * function it answers is called: the Project's close waits for it before it closes the store. Throws
	 * `PROJECT_NOT_OPENED` while that Project closes (provided by the owning Project).
	 */
	private startWrite: () => () => void

	/** Track concurrent transactions to manage loading flag */
	private activeTransactions = 0

	constructor(
		store: Store,
		config: GenericConfig,
		documentId: string,
		extensions: GenericExtension | undefined,
		hooks: DialecteHooks<GenericConfig> | undefined,
		project: {
			state: DocumentState
			channelName: string
			broadcast: (message: ProjectChannelMessage) => void
			refreshHistoryStatus: () => Promise<void>
			perf: Perf
			subscribeState: (callback: (terminal: boolean) => void) => () => void
			signalStateChange: (terminal: boolean) => void
			startWrite: () => () => void
		},
	) {
		this.store = store
		this.config = config
		this.documentId = documentId
		this.hooks = hooks
		this.extensionsRegistry = extensions
		this.state = project.state
		this.channelName = project.channelName
		this.broadcast = project.broadcast
		this.refreshHistoryStatus = project.refreshHistoryStatus
		this.perf = project.perf
		this.subscribe = project.subscribeState
		this.signalStateChange = project.signalStateChange
		this.startWrite = project.startWrite
	}

	//== Query access (read-only, no mutations exposed)

	private withQueryExtensions(
		query: Query<GenericConfig>,
	): Query<GenericConfig> & QueryExtensions<GenericExtension> {
		const bound = bindExtensions(this.extensionsRegistry?.query, query)
		return Object.assign(query, bound) as Query<GenericConfig> & QueryExtensions<GenericExtension>
	}

	private withAllExtensions(
		tx: Transaction<GenericConfig>,
	): Transaction<GenericConfig> & AllExtensions<GenericExtension> {
		const queryBound = bindExtensions(this.extensionsRegistry?.query, tx)
		const txBound = bindExtensions(this.extensionsRegistry?.transaction, tx)
		// Deep-merge per group so that a module with both query and transaction
		// methods does not have its query methods overwritten
		// by the transaction group when Object.assign processes the same key.
		const merged: Record<string, Record<string, unknown>> = {}

		for (const [k, v] of Object.entries(queryBound as Record<string, object>))
			merged[k] = { ...merged[k], ...v }

		for (const [k, v] of Object.entries(txBound as Record<string, object>))
			merged[k] = { ...merged[k], ...v }

		return Object.assign(tx, merged) as Transaction<GenericConfig> & AllExtensions<GenericExtension>
	}

	/**
	 * Override in dialecte subclass to return a domain-specific Query.
	 */
	protected createQuery(): Query<GenericConfig> {
		return new Query(this.store, this.config, this.documentId, this.perf)
	}

	get query(): Query<GenericConfig> & QueryExtensions<GenericExtension> {
		return this.withQueryExtensions(this.createQuery())
	}

	//== Transaction scope

	/**
	 * Override in dialecte subclass to return a domain-specific Transaction.
	 * e.g. SclDocument overrides this to return new SclTransaction(...)
	 */
	protected createTransaction(): Transaction<GenericConfig> {
		return new Transaction(
			this.store,
			this.config,
			this.documentId,
			this.state,
			this.hooks,
			this.perf,
			this.signalStateChange,
		)
	}

	/**
	 * Run `fn` against a new transaction and commit everything it staged as one undoable step; on a
	 * throw nothing is written. A second transaction started on this Document while one runs throws
	 * `CONCURRENT_TRANSACTION`.
	 *
	 * @intent change a document, add or update or delete elements and commit them, group edits into one undo step
	 *
	 * @example
	 * ```ts
	 * await doc.transaction(async (tx) => {
	 *   await tx.addChild(root, { tagName: 'A', attributes: { aA: 'a' } })
	 * }, { label: 'Add A' })
	 * ```
	 */
	async transaction<T>(
		fn: (tx: Transaction<GenericConfig> & AllExtensions<GenericExtension>) => Promise<T>,
		options?: { label?: string },
	): Promise<T> {
		this.assertNoActiveTransaction()
		// refused while the Project closes, before anything changed
		const endWrite = this.startWrite()
		let tx: (Transaction<GenericConfig> & AllExtensions<GenericExtension>) | undefined

		try {
			this.activeTransactions++
			this.state.loading = true
			this.state.error = null
			this.signalStateChange(false)

			const transaction = this.withAllExtensions(this.createTransaction())
			tx = transaction
			const result = await fn(transaction)

			await transaction.finishStaging()
			await transaction.commit()
			// Refresh canUndo/canRedo on the shared entry locally (mirrors
			// Project.undo/redo) so state is correct synchronously — no channel
			// echo required.
			await this.refreshHistoryStatus()
			this.broadcast({
				type: 'commit',
				documentId: this.documentId,
				timestamp: this.state.lastUpdate ?? Date.now(),
			})
			transaction.clearStagedOperations()
			transaction.clearRecordCache()
			this.state.history.push({
				method: 'commit',
				message: options?.label ?? 'Changes committed',
				timestamp: Date.now(),
			})

			return result
		} catch (error) {
			throw this.reportFailure(error)
		} finally {
			// the transaction's own state ended first: a subscriber that throws as it is told below never holds the
			// Project's close nor leaves this Document holding a transaction
			endWrite()
			this.activeTransactions--
			this.state.loading = false
			tx?.progress.forceClear()
			this.signalStateChange(true)
		}
	}

	/**
	 * Build up operations without committing.
	 * Returns a PreparedTransaction with staged operations for preview,
	 * then call commit() to apply or discard() to throw away.
	 *
	 * @intent preview changes before committing, ask a user to confirm an edit, dry-run a transaction
	 *
	 * @example
	 * ```ts
	 * const prepared = await doc.prepare(async (tx) => {
	 *   tx.addChild(parent, { tagName: 'Function', attributes: { ... } })
	 *   tx.deepClone(parent, tree)
	 * })
	 *
	 * // Show preview in UI
	 * renderDiff(prepared.operations, prepared.summary)
	 *
	 * // User confirms
	 * await prepared.commit()
	 * // or: prepared.discard()
	 * ```
	 */
	async prepare(
		fn: (tx: Transaction<GenericConfig> & AllExtensions<GenericExtension>) => Promise<void>,
		options?: { label?: string },
	): Promise<PreparedTransaction<GenericConfig, GenericExtension>> {
		this.assertNoActiveTransaction()
		this.activeTransactions++
		this.state.loading = true
		this.state.error = null

		const tx = this.createTransaction()

		try {
			await fn(this.withAllExtensions(tx))
			await tx.finishStaging()
		} catch (error) {
			this.activeTransactions--
			this.state.loading = false
			throw this.reportFailure(error)
		}

		// Stop loading — build phase done, waiting for user decision
		this.activeTransactions--
		this.state.loading = false

		const operations = tx.getStagedOperations()
		const summary = summarizeOperations(operations)

		let settled = false

		return {
			operations,
			summary,

			// `tx` was extension-bound in place by withAllExtensions above and is
			// alive in this closure. Exposed as Query (+ query extensions) so only
			// reads are visible.
			query: tx as unknown as Query<GenericConfig> & QueryExtensions<GenericExtension>,

			commit: async () => {
				if (settled) {
					return
				}
				this.assertNoActiveTransaction()
				// refused while the Project closes: the prepared commit can be committed again later
				const endWrite = this.startWrite()
				settled = true

				this.activeTransactions++
				this.state.loading = true

				try {
					await tx.commit()
					// Refresh canUndo/canRedo locally so the shared entry is correct
					// synchronously — no channel echo required.
					await this.refreshHistoryStatus()
					this.broadcast({
						type: 'commit',
						documentId: this.documentId,
						timestamp: this.state.lastUpdate ?? Date.now(),
					})

					tx.clearStagedOperations()
					tx.clearRecordCache()
					this.state.history.push({
						method: 'commit',
						message: options?.label ?? 'Changes committed',
						timestamp: Date.now(),
					})
				} catch (error) {
					throw this.reportFailure(error)
				} finally {
					this.activeTransactions--
					this.state.loading = false
					endWrite()
				}
			},

			discard: () => {
				if (settled) {
					return
				}
				settled = true
				tx.clearStagedOperations()
				tx.clearRecordCache()
			},
		}
	}

	/**
	 * What a failed operation throws, kept as the document's last error: a structured error stays
	 * what it is — its key, its data — and anything else is reported as unknown, the original kept
	 * as its cause.
	 */
	private reportFailure(error: unknown): Error {
		const carried = toDialecteError(error)
		if (error instanceof Error && carried) {
			this.state.error = carried
			return error
		}

		const reported = createDialecteError('UNKNOWN', {
			detail: error instanceof Error ? error.message : String(error),
			cause: error instanceof Error ? error : undefined,
		})
		this.state.error = toDialecteError(reported) ?? null
		return reported
	}

	//== Lifecycle

	/**
	 * One write at a time on this Document: a transaction, a prepare or a prepared commit started while
	 * another is open would stage against records the other is about to overwrite.
	 */
	private assertNoActiveTransaction(): void {
		if (this.activeTransactions > 0) {
			throwDialecteError('CONCURRENT_TRANSACTION', {
				detail: `${this.activeTransactions} transaction(s) already active. Concurrent transactions risk lost updates — serialize them or implement a transaction queue.`,
			})
		}
	}

	/**
	 * Close the connection to the project's store, shared by every document of the project: after it,
	 * no document of this project can read or write. With a built-in store (local, in-memory), opening
	 * the project again gives a new store: documents opened before stay closed, open them again from
	 * the project. A custom store is reopened in place. To finish with the
	 * project, use `project.close`.
	 *
	 * @intent close the project's database connection from a document
	 */
	close(): void {
		this.store.close()
	}

	/**
	 * Delete the whole project database and let the connection go: every document of the project, its
	 * history and its blobs - not only this document; refused `PROJECT_OPEN_ELSEWHERE`, nothing removed and
	 * the connection kept, while another connection has the project open. To delete one document, use
	 * `project.removeDocument`.
	 *
	 * @intent delete the whole project database from a document, wipe every document of the project
	 */
	async destroy(): Promise<void> {
		await this.store.destroy()
	}
}
