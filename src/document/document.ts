import { Query } from './query'
import { Transaction } from './transaction'

import { throwDialecteError } from '@/errors'

import type { PreparedTransaction, DocumentState } from './types'
import type { Store } from '@/store'
import type { AnyDialecteConfig } from '@/types/dialecte-config'

/**
 * Document — the public entry point for querying and mutating a dialecte.
 *
 * Queries: doc.query.getRoot(), doc.query.findChildren(...), etc.
 * Mutations: doc.transaction(async (tx) => { tx.addChild(...) })
 *
 * Single observable state: doc.state — loading, error, activity, progress, history.
 * Transaction mutates this state directly (no separate transaction state).
 *
 * Subclass in a dialecte to override createQuery() / createTransaction()
 * and return domain-specific subclasses (e.g. SclQuery, SclTransaction).
 */
export class Document<GenericConfig extends AnyDialecteConfig> {
	protected store: Store
	protected config: GenericConfig

	readonly state: DocumentState = {
		loading: false,
		error: null,
		activity: null,
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

	constructor(store: Store, config: GenericConfig) {
		this.store = store
		this.config = config
		this.channel = new BroadcastChannel(`core::${store.name}`)
		this.channel.onmessage = (event: MessageEvent<number>) => {
			this.state.lastUpdate = event.data
		}
	}

	//== Query access (read-only, no mutations exposed)

	/**
	 * Override in dialecte subclass to return a domain-specific Query.
	 */
	protected createQuery(): Query<GenericConfig> {
		return new Query(this.store, this.config)
	}

	get query(): Query<GenericConfig> {
		return this.createQuery()
	}

	//== Transaction scope

	/**
	 * Override in dialecte subclass to return a domain-specific Transaction.
	 * e.g. SclDocument overrides this to return new SclTransaction(...)
	 */
	protected createTransaction(): Transaction<GenericConfig> {
		return new Transaction(this.store, this.config, this.state)
	}

	async transaction<T>(
		fn: (tx: Transaction<GenericConfig>) => Promise<T>,
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

		const tx = this.createTransaction()

		try {
			const result = await fn(tx)

			this.state.activity = { method: 'commit', message: 'Saving changes...' }
			await tx.commit()
			this.channel.postMessage(this.state.lastUpdate)
			tx.clearStagedOperations()
			tx.clearRecordCache()
			this.state.activity = null
			this.state.history.push({
				method: 'commit',
				message: options?.label ?? 'Changes committed',
				timestamp: Date.now(),
			})

			return result
		} catch (error) {
			this.state.activity = null
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
			this.state.loading = this.activeTransactions > 0
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
		fn: (tx: Transaction<GenericConfig>) => Promise<void>,
		options?: { label?: string },
	): Promise<PreparedTransaction<GenericConfig>> {
		this.activeTransactions++
		this.state.loading = true
		this.state.error = null

		const tx = this.createTransaction()

		try {
			await fn(tx)
		} catch (error) {
			this.activeTransactions--
			this.state.loading = this.activeTransactions > 0
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
		this.state.loading = this.activeTransactions > 0

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
				this.state.activity = { method: 'commit', message: 'Saving changes...' }

				try {
					await tx.commit()
					this.channel.postMessage(this.state.lastUpdate)

					tx.clearStagedOperations()
					tx.clearRecordCache()
					this.state.activity = null
					this.state.history.push({
						method: 'commit',
						message: options?.label ?? 'Changes committed',
						timestamp: Date.now(),
					})
				} catch (error) {
					this.state.activity = null
					throw (
						this.state.error ??
						throwDialecteError('UNKNOWN', {
							detail: error instanceof Error ? error.message : String(error),
							cause: error instanceof Error ? error : undefined,
						})
					)
				} finally {
					this.activeTransactions--
					this.state.loading = this.activeTransactions > 0
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

	//== Lifecycle

	async undo(): Promise<void> {
		this.state.loading = true
		this.state.activity = { method: 'commit', message: 'Undoing...' }
		this.state.error = null

		try {
			await this.store.undo()
			this.channel.postMessage(Date.now())
			this.state.history.push({ method: 'commit', message: 'Undo', timestamp: Date.now() })
		} catch (error) {
			this.state.activity = null
			throw (
				this.state.error ??
				throwDialecteError('UNKNOWN', {
					detail: error instanceof Error ? error.message : String(error),
					cause: error instanceof Error ? error : undefined,
				})
			)
		} finally {
			this.state.loading = false
			this.state.activity = null
		}
	}

	async redo(): Promise<void> {
		this.state.loading = true
		this.state.activity = { method: 'commit', message: 'Redoing...' }
		this.state.error = null

		try {
			await this.store.redo()
			this.channel.postMessage(Date.now())
			this.state.history.push({ method: 'commit', message: 'Redo', timestamp: Date.now() })
		} catch (error) {
			this.state.activity = null
			throw (
				this.state.error ??
				throwDialecteError('UNKNOWN', {
					detail: error instanceof Error ? error.message : String(error),
					cause: error instanceof Error ? error : undefined,
				})
			)
		} finally {
			this.state.loading = false
			this.state.activity = null
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
