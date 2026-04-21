import { bindExtensions } from './bind-extensions'
import { Query } from './query'
import { Transaction } from './transaction'

import { throwDialecteError } from '@/errors'

import type { PreparedTransaction, DocumentState } from './types'
import type { Store } from '@/store'
import type { AnyDialecteConfig, TransactionHooks } from '@/types/dialecte-config'
import type { AllExtensions, ExtensionsRegistry, QueryExtensions } from '@/types/extensions'

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
	protected hooks: TransactionHooks<GenericConfig> | undefined
	private extensionsRegistry?: GenericExtension

	readonly state: DocumentState = {
		loading: false,
		error: null,
		progress: null,
		history: [],
		lastUpdate: null,
	}

	/** Track concurrent transactions to manage loading flag */
	private activeTransactions = 0

	/**
	 * BroadcastChannel scoped to this database.
	 * Receives update events from other Document instances (other extensions)
	 * targeting the same database, keeping state.lastUpdate in sync.
	 *
	 * BroadcastChannel does not deliver messages back to the sender,
	 * so no self-filter is needed.
	 */
	private channel: BroadcastChannel

	constructor(
		store: Store,
		config: GenericConfig,
		extensions?: GenericExtension,
		hooks?: TransactionHooks<GenericConfig>,
	) {
		this.store = store
		this.config = config
		this.hooks = hooks
		this.extensionsRegistry = extensions
		this.channel = new BroadcastChannel(`core::${store.name}`)
		this.channel.onmessage = (event: MessageEvent<number>) => {
			this.state.lastUpdate = event.data
		}
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
		return Object.assign(tx, queryBound, txBound) as Transaction<GenericConfig> &
			AllExtensions<GenericExtension>
	}

	/**
	 * Override in dialecte subclass to return a domain-specific Query.
	 */
	protected createQuery(): Query<GenericConfig> {
		return new Query(this.store, this.config)
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
		return new Transaction(this.store, this.config, this.state, this.hooks)
	}

	async transaction<T>(
		fn: (tx: Transaction<GenericConfig> & AllExtensions<GenericExtension>) => Promise<T>,
		options?: { label?: string },
	): Promise<T> {
		if (this.activeTransactions > 0) {
			throwDialecteError('CONCURRENT_TRANSACTION', {
				detail: `${this.activeTransactions} transaction(s) already active. Concurrent transactions risk lost updates — serialize them or implement a transaction queue.`,
			})
		}

		this.activeTransactions++
		this.state.loading = true
		this.state.error = null

		const tx = this.withAllExtensions(this.createTransaction())

		try {
			const result = await fn(tx)

			await tx.commit()
			this.channel.postMessage(this.state.lastUpdate)
			tx.clearStagedOperations()
			tx.clearRecordCache()
			tx.clearCumulativeCloneMappings()
			this.state.history.push({
				method: 'commit',
				message: options?.label ?? 'Changes committed',
				timestamp: Date.now(),
			})

			return result
		} catch (error) {
			this.state.progress = null
			throw (
				this.state.error ??
				throwDialecteError('UNKNOWN', {
					detail: error instanceof Error ? error.message : String(error),
					cause: error instanceof Error ? error : undefined,
				})
			)
		} finally {
			this.activeTransactions--
			this.state.loading = false
		}
	}

	/**
	 * Build up operations without committing.
	 * Returns a PreparedTransaction with staged operations for preview,
	 * then call commit() to apply or discard() to throw away.
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
	): Promise<PreparedTransaction<GenericConfig>> {
		this.activeTransactions++
		this.state.loading = true
		this.state.error = null

		const tx = this.createTransaction()

		try {
			await fn(this.withAllExtensions(tx))
		} catch (error) {
			this.activeTransactions--
			this.state.loading = false
			throw (
				this.state.error ??
				throwDialecteError('UNKNOWN', {
					detail: error instanceof Error ? error.message : String(error),
					cause: error instanceof Error ? error : undefined,
				})
			)
		}

		// Stop loading — build phase done, waiting for user decision
		this.activeTransactions--
		this.state.loading = false

		const operations = tx.getStagedOperations()
		const summary = {
			creates: operations.filter((op) => op.status === 'created').length,
			updates: operations.filter((op) => op.status === 'updated').length,
			deletes: operations.filter((op) => op.status === 'deleted').length,
		}

		let settled = false

		return {
			operations,
			summary,

			commit: async () => {
				if (settled) {
					return
				}
				settled = true

				this.activeTransactions++
				this.state.loading = true

				try {
					await tx.commit()
					this.channel.postMessage(this.state.lastUpdate)

					tx.clearStagedOperations()
					tx.clearRecordCache()
					tx.clearCumulativeCloneMappings()
					this.state.history.push({
						method: 'commit',
						message: options?.label ?? 'Changes committed',
						timestamp: Date.now(),
					})
				} catch (error) {
					throw (
						this.state.error ??
						throwDialecteError('UNKNOWN', {
							detail: error instanceof Error ? error.message : String(error),
							cause: error instanceof Error ? error : undefined,
						})
					)
				} finally {
					this.activeTransactions--
					this.state.loading = false
				}
			},

			discard: () => {
				if (settled) {
					return
				}
				settled = true
				tx.clearStagedOperations()
				tx.clearRecordCache()
				tx.clearCumulativeCloneMappings()
			},
		}
	}

	//== Lifecycle

	async undo(): Promise<void> {
		this.state.loading = true
		this.state.error = null

		try {
			await this.store.undo()
			this.channel.postMessage(Date.now())
			this.state.history.push({ method: 'undo', message: 'Undo', timestamp: Date.now() })
		} catch (error) {
			throw (
				this.state.error ??
				throwDialecteError('UNKNOWN', {
					detail: error instanceof Error ? error.message : String(error),
					cause: error instanceof Error ? error : undefined,
				})
			)
		} finally {
			this.state.loading = false
		}
	}

	async redo(): Promise<void> {
		this.state.loading = true
		this.state.error = null

		try {
			await this.store.redo()
			this.channel.postMessage(Date.now())
			this.state.history.push({ method: 'redo', message: 'Redo', timestamp: Date.now() })
		} catch (error) {
			throw (
				this.state.error ??
				throwDialecteError('UNKNOWN', {
					detail: error instanceof Error ? error.message : String(error),
					cause: error instanceof Error ? error : undefined,
				})
			)
		} finally {
			this.state.loading = false
		}
	}

	/** Close the store connection */
	close(): void {
		this.store.close()
	}

	/** Close connection and delete the database entirely */
	async destroy(): Promise<void> {
		this.channel.close()
		await this.store.destroy()
	}
}
