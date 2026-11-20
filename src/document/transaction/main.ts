import { createProgressReporter } from '../progress'
import { Query } from '../query'
import { createStagedOperations } from '../staged-operations'
import {
	createTransactionReadCache,
	dropTransactionReadCache,
	followReadEpoch,
	readEpochOf,
} from '../transaction-read-cache'
import { TRANSACTION_READ_CACHE_PERF } from '../transaction-read-cache.constants'
import { AnyTransaction } from './any'
import { stageBeforeCommit } from './before-commit'
import { stageDeepClone } from './clone'
import { commitTransaction } from './commit'
import { stageAddChild } from './create'
import { stageDelete } from './delete'
import { stageEnsureChild } from './ensure'
import { stageMove } from './move'
import { stageUpdate } from './update'

import { toRef } from '@/helpers'
import { NOOP_PERF } from '@/perf'

import type { ProgressReporter } from '../progress'
import type { TransactionReadCache } from '../transaction-read-cache.types'
import type { DocumentState } from '../types'
import type { Context, StagedOperations } from '../types'
import type { CloneResult } from './clone'
import type { AddChildParams } from './create'
import type { MoveParams } from './move'
import type { MovePointer } from './move/move.types'
import type { UpdateParams } from './update'
import type { Ref, RefOrRecord } from '@/document'
import type { Perf } from '@/perf'
import type { CommitChanges, UnknownCommitChanges } from '@/project/types'
import type { Store } from '@/store'
import type {
	AnyDialecteConfig,
	ChildrenOf,
	ElementsOf,
	Operation,
	ParentsOf,
	RawRecord,
	TreeRecord,
	TransactionHooks,
} from '@/types'

/**
 * Transaction — a scoped unit of work against a document.
 *
 * Extends Query: queries overlay staged ops on top of store reads
 * via getOperations() override (the single override point).
 * Adds mutation methods (addChild, update, delete, deepClone).
 *
 * Mutates Document's state directly (loading, progress, history).
 * No separate transaction state — the UI sees one unified state.
 *
 * Lifecycle: created by Document → used in callback → committed by Document → discarded.
 *
 * Subclass in a dialecte (e.g. SclTransaction) to add domain-specific mutations.
 */
export class Transaction<GenericConfig extends AnyDialecteConfig> extends Query<GenericConfig> {
	/** Ordered write log + derived by-id index (kept in sync by stageOperation). */
	protected stagedOperations: StagedOperations<GenericConfig> = createStagedOperations()
	protected documentActivity: DocumentState
	/** The stored records this transaction read (`transaction-read-cache.ts`): by id, by tag, and tags read whole. */
	protected readCache: TransactionReadCache = createTransactionReadCache()
	protected hooks: TransactionHooks<GenericConfig> | undefined
	protected progressReporter: ProgressReporter
	private _anyTx?: AnyTransaction<GenericConfig>
	private stagingFinished = false

	constructor(
		store: Store,
		dialecteConfig: GenericConfig,
		documentId: string,
		documentActivity: DocumentState,
		hooks?: TransactionHooks<GenericConfig>,
		perf: Perf = NOOP_PERF,
		signalStateChange: (terminal: boolean) => void = () => {},
	) {
		super(store, dialecteConfig, documentId, perf)
		this.documentActivity = documentActivity
		this.hooks = hooks
		this.progressReporter = createProgressReporter(documentActivity, signalStateChange)
	}

	/** Reachable by extensions via `tx.progress` to report coarse progress. */
	get progress(): ProgressReporter {
		return this.progressReporter
	}

	//== Untyped namespace

	override get any(): AnyTransaction<GenericConfig> {
		return (this._anyTx ??= new AnyTransaction(
			() => this.context,
			this.dialecteConfig,
			this.hooks,
			this,
		))
	}

	//== Mutations (sync — stage operations, return Refs)

	/**
	 * Override: returns staged operations so Query's record methods overlay them.
	 */
	protected override getOperations(): StagedOperations<GenericConfig> {
		return this.stagedOperations
	}

	/**
	 * Single context for both reads and writes inside a Transaction.
	 * Overrides Query's cacheless context — adds the transaction-scoped cache
	 * and the mutable staged-operations container (mutation FP functions push to it).
	 */
	protected override get context(): Context<GenericConfig> {
		// every read starts here: a change told since the cache was filled (another view's commit) empties it first
		if (followReadEpoch({ cache: this.readCache, readEpoch: readEpochOf({ transaction: this }) })) {
			this.perf.count(TRANSACTION_READ_CACHE_PERF.dropped)
		}
		return {
			kind: 'transaction',
			store: this.store,
			dialecteConfig: this.dialecteConfig,
			documentId: this.documentId,
			recordCache: this.readCache.records,
			readCache: this.readCache,
			stagedOperations: this.stagedOperations,
			progress: this.progressReporter,
			perf: this.perf,
		}
	}

	//== Mutation methods

	/**
	 * Add a child element to a parent. It always creates one; `ensureChild` reuses an existing child.
	 *
	 * @intent create a new element under a parent, insert a child with attributes, build new content in a transaction
	 *
	 * @param parentRefOrRecord - The parent element (ref, record, or relationship). `undefined` for root.
	 * @param params - Child tagName, attributes and optional namespace, value, id.
	 * @returns RawRecord of the created child.
	 *
	 * @example
	 * ```ts
	 * const aRecord = await tx.addChild(root, {
	 *   tagName: 'A',
	 *   attributes: { name: 'aA1' },
	 * })
	 * ```
	 */
	async addChild<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
	>(
		parentRefOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: AddChildParams<GenericConfig, GenericElement, GenericChildElement>,
	): Promise<RawRecord<GenericConfig, GenericChildElement>> {
		return stageAddChild({
			context: this.context,
			parentRef: toRef(parentRefOrRecord),
			params,
			dialecteConfig: this.dialecteConfig,
			hooks: this.hooks,
			query: this,
		})
	}

	/**
	 * Get an existing child record or create it under the given parent.
	 *
	 * The lookup reads only the direct children of the parent with `params.tagName` (never the whole
	 * document), in this order:
	 * 1. Attributes with a non-empty value given: the first of those children whose attributes match them
	 *    (`params.id` is then not used for the lookup).
	 * 2. Otherwise, `params.id` given: the child with that id.
	 * 3. Otherwise: the first of those children.
	 * 4. No match: the child is created from `params`, as `addChild` would.
	 *
	 * @intent get or create a child, make sure a singleton container exists before adding under it, add a child without duplicating it
	 *
	 * @param parentRefOrRecord - The parent element (ref, record, or relationship). `undefined` for root.
	 * @param params - Child tagName, attributes and optional namespace, value, id.
	 * @returns The record of the existing or created child.
	 *
	 * @example
	 * ```ts
	 * const a = await tx.ensureChild(root, {
	 *   tagName: 'A',
	 *   attributes: {},
	 * })
	 * ```
	 * If an A already exists under root, returns its record. Otherwise, creates it and returns the new record.
	 */
	async ensureChild<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
	>(
		parentRefOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: AddChildParams<GenericConfig, GenericElement, GenericChildElement>,
	): Promise<RawRecord<GenericConfig, GenericChildElement>> {
		return stageEnsureChild({
			context: this.context,
			parentRef: toRef(parentRefOrRecord),
			params,
			dialecteConfig: this.dialecteConfig,
			hooks: this.hooks,
			query: this,
		})
	}

	/**
	 * Update attributes of an existing element.
	 *
	 * @intent change attribute values, set or clear an attribute, rename an element through its name attribute, set an element's text value
	 *
	 * @param refOrRecord - The element to update (ref, record, or relationship).
	 * @param params - New attribute values.
	 * @returns RawRecord of the updated element.
	 *
	 * @example
	 * ```ts
	 * await tx.update(root, {
	 *   attributes: { name: 'aA1', desc: 'new element' },
	 * })
	 * ```
	 */
	async update<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: UpdateParams<GenericConfig, GenericElement>,
	): Promise<RawRecord<GenericConfig, GenericElement>> {
		return stageUpdate({
			context: this.context,
			ref: toRef(refOrRecord),
			params,
			dialecteConfig: this.dialecteConfig,
			hooks: this.hooks,
			query: this,
		})
	}

	/**
	 * Delete an element and its entire subtree.
	 *
	 * @intent remove an element, delete a subtree, prune a child from its parent
	 *
	 * @param refOrRecord - The element to delete (ref, record, or relationship).
	 * @returns RawRecord of the deleted element's parent.
	 *
	 * @example
	 * ```ts
	 * const parentRecord = await tx.delete(aRecord)
	 * ```
	 */
	async delete<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
	): Promise<RawRecord<GenericConfig, ParentsOf<GenericConfig, GenericElement>>> {
		return stageDelete({
			context: this.context,
			ref: toRef(refOrRecord),
			hooks: this.hooks,
			query: this,
		})
	}

	/**
	 * Move an element and its subtree under another parent of the same document, or to another place among
	 * its siblings. Record ids are kept: only the element's `parent` and both parents' `children` change.
	 * The element goes right before `before` (a child of the new parent with the element's tag) or, without
	 * `before`, after the new parent's last child with that tag. A move to the place it holds stages nothing.
	 * Refused: the root, a new parent that may not hold the tag or holds as many of it as it may, a new parent
	 * inside the moved subtree, a `before` that is no child of the new parent with that tag. Core follows no
	 * reference: a dialecte that keeps references or paths updates them at its commit.
	 *
	 * @intent cut and paste inside a document, re-parent an element, move a subtree under another parent, reorder an element among its siblings
	 *
	 * @param refOrRecord - The element to move (ref, record, or relationship).
	 * @param params - `parent`, the new parent; `before`, the sibling to move it before.
	 * @returns The moved element's record, under its new parent.
	 *
	 * @example
	 * ```ts
	 * await tx.move(aa1, { parent: otherA })
	 * ```
	 */
	async move<
		GenericElement extends ChildrenOf<GenericConfig, GenericParent>,
		GenericParent extends ElementsOf<GenericConfig>,
	>(
		refOrRecord: MovePointer<GenericConfig, GenericElement>,
		params: MoveParams<GenericConfig, GenericElement, GenericParent>,
	): Promise<RawRecord<GenericConfig, GenericElement>> {
		return stageMove({
			context: this.context,
			ref: toRef(refOrRecord as Ref<GenericConfig, GenericElement>),
			parentRef: toRef(params.parent as Ref<GenericConfig, GenericParent>),
			beforeRef:
				params.before === undefined
					? undefined
					: toRef(params.before as Ref<GenericConfig, GenericElement>),
		})
	}

	/**
	 * Deep-clone a subtree under a new parent.
	 *
	 * @intent copy a subtree with fresh ids, duplicate an element under another parent, paste a tree read with getTree, map old ids to new ids
	 *
	 * @param parentRefOrRecord - The target parent for the clone.
	 * @param record - The tree record to clone (from `getTree`).
	 * @returns `{ record, mappings }`: the cloned root raw record and, per cloned node, its source and
	 *   target refs.
	 *
	 * @example
	 * ```ts
	 * const tree = await tx.getTree(aa1) // an AA_1 to copy
	 * const { record, mappings } = await tx.deepClone(a, tree) // under an A
	 * ```
	 */
	async deepClone<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
	>(
		parentRefOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		record: TreeRecord<GenericConfig, GenericChildElement>,
	): Promise<CloneResult<GenericConfig, GenericChildElement>> {
		return stageDeepClone({
			dialecteConfig: this.dialecteConfig,
			hooks: this.hooks,
			context: this.context,
			parentRef: toRef(parentRefOrRecord),
			record,
			query: this,
		})
	}

	//== Internal — called by Document, not by consumers

	/**
	 * Run the `beforeCommit` hook once, when the transaction's work is done, and stage
	 * what it returns. Called by Document.transaction() / prepare() after the callback; not meant for callers.
	 *
	 * @internal Used by Document.transaction and Document.prepare to run beforeCommit hooks.
	 */
	async finishStaging(): Promise<void> {
		if (this.stagingFinished) return
		this.stagingFinished = true
		await stageBeforeCommit({ hooks: this.hooks, context: this.context, query: this })
	}

	/**
	 * Returns a read-only view of the staged operations (for prepare/preview). Called by Document, not meant for callers.
	 *
	 * @internal Used by Document.prepare to list pending operations.
	 */
	getStagedOperations(): ReadonlyArray<Operation<GenericConfig>> {
		return this.stagedOperations.log
	}

	/**
	 * Free staged operations from memory. Called by Document after commit or discard, not meant for callers.
	 *
	 * @internal Used by Document.transaction to release staged writes.
	 */
	clearStagedOperations(): void {
		this.stagedOperations = createStagedOperations()
	}

	/**
	 * Free cached records from memory. Called by Document after commit or discard, not meant for callers.
	 *
	 * @internal Used by Document.transaction to release the record cache.
	 */
	clearRecordCache(): void {
		dropTransactionReadCache({ cache: this.readCache })
	}

	/**
	 * Commit all staged operations to the store atomically.
	 * Called by Document.transaction() after user callback completes; not meant for callers.
	 *
	 * Updates documentState (loading, progress, lastCommit).
	 * Merges operations by ID to optimize database writes.
	 * Writes under the caller's `writeId` (the commit message's `changeId`); answers what the commit changed, for the
	 * commit message.
	 *
	 * @internal Used by Document.transaction to write staged operations to the store.
	 */
	async commit(params: { writeId: string }): Promise<CommitChanges | UnknownCommitChanges> {
		return commitTransaction({
			writeId: params.writeId,
			stagedOperations: this.stagedOperations.log,
			store: this.store,
			documentId: this.documentId,
			documentState: this.documentActivity,
			progress: this.progressReporter,
			perf: this.perf,
		})
	}
}
