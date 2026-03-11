import { Query } from '../query'
import { stageDeepClone } from './clone'
import { commitTransaction } from './commit'
import { stageAddChild } from './create'
import { stageDelete } from './delete'
import { stageUpdate } from './update'

import { toRef } from '@/helpers'

import type { DocumentState } from '../types'
import type { Context } from '../types'
import type { CloneResult } from './clone'
import type { AddChildParams } from './create'
import type { UpdateParams } from './update'
import type { Store } from '@/store'
import type {
	AnyDialecteConfig,
	AnyRawRecord,
	ChildrenOf,
	ElementsOf,
	Operation,
	ParentsOf,
	Ref,
	RefOrRecord,
	TreeRecord,
} from '@/types'

/**
 * Transaction — a scoped unit of work against a document.
 *
 * Extends Query: queries overlay staged ops on top of store reads
 * via getOperations() override (the single override point).
 * Adds mutation methods (addChild, update, delete, deepClone).
 *
 * Mutates Document's state directly (activity, progress, history).
 * No separate transaction state — the UI sees one unified state.
 *
 * Lifecycle: created by Document → used in callback → committed by Document → discarded.
 *
 * Subclass in a dialecte (e.g. SclTransaction) to add domain-specific mutations.
 */
export class Transaction<GenericConfig extends AnyDialecteConfig> extends Query<GenericConfig> {
	protected stagedOperations: Operation<GenericConfig>[] = []
	protected documentState: DocumentState
	protected recordCache = new Map<string, AnyRawRecord>()

	constructor(store: Store, dialecteConfig: GenericConfig, documentState: DocumentState) {
		super(store, dialecteConfig)
		this.documentState = documentState
	}

	//== Mutations (sync — stage operations, return Refs)

	/**
	 * Override: returns staged operations so Query's record methods overlay them.
	 */
	protected override getOperations(): Operation<GenericConfig>[] {
		return this.stagedOperations
	}

	/**
	 * Single context for both reads and writes inside a Transaction.
	 * Overrides Query's cacheless context — adds the transaction-scoped cache
	 * and a mutable stagedOperations array (mutation FP functions push to it).
	 */
	protected override get context(): Context<GenericConfig> {
		return {
			store: this.store,
			recordCache: this.recordCache,
			stagedOperations: this.stagedOperations,
		}
	}

	//== Mutation methods

	/**
	 * Add a child element to a parent.
	 *
	 * @param parentRefOrRecord - The parent element (ref, record, or relationship). `undefined` for root.
	 * @param params - Child tagName, attributes and optional namespace, value, id.
	 * @returns Ref to the created child.
	 *
	 * @example
	 * ```ts
	 * const bayRef = await tx.addChild(substation, {
	 *   tagName: 'VoltageLevel',
	 *   attributes: { name: 'VL1' },
	 * })
	 * ```
	 */
	async addChild<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
	>(
		parentRefOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: AddChildParams<GenericConfig, GenericElement, GenericChildElement>,
	): Promise<Ref<GenericConfig, GenericChildElement>> {
		return stageAddChild({
			context: this.context,
			parentRef: toRef(parentRefOrRecord),
			params,
			dialecteConfig: this.dialecteConfig,
		})
	}

	/**
	 * Update attributes of an existing element.
	 *
	 * @param refOrRecord - The element to update (ref, record, or relationship).
	 * @param params - New attribute values.
	 * @returns Ref to the updated element.
	 *
	 * @example
	 * ```ts
	 * await tx.update(bay, {
	 *   attributes: { name: 'Q02', desc: 'Feeder bay' },
	 * })
	 * ```
	 */
	async update<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: UpdateParams<GenericConfig, GenericElement>,
	): Promise<Ref<GenericConfig, GenericElement>> {
		return stageUpdate({
			context: this.context,
			ref: toRef(refOrRecord),
			params,
			dialecteConfig: this.dialecteConfig,
		})
	}

	/**
	 * Delete an element and its entire subtree.
	 *
	 * @param refOrRecord - The element to delete (ref, record, or relationship).
	 * @returns Ref to the deleted element's parent.
	 *
	 * @example
	 * ```ts
	 * const parentRef = await tx.delete(bay)
	 * ```
	 */
	async delete<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
	): Promise<Ref<GenericConfig, ParentsOf<GenericConfig, GenericElement>>> {
		return stageDelete({ context: this.context, ref: toRef(refOrRecord) })
	}

	/**
	 * Deep-clone a subtree under a new parent.
	 *
	 * @param parentRefOrRecord - The target parent for the clone.
	 * @param record - The tree record to clone (from `getTree`).
	 * @returns The cloned root ref and an ID mapping from old to new.
	 *
	 * @example
	 * ```ts
	 * const tree = await tx.getTree(bay)
	 * const { ref, idMap } = await tx.deepClone(substation, tree)
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
			context: this.context,
			parentRef: toRef(parentRefOrRecord),
			record,
		})
	}

	//== Internal — called by Document, not by consumers

	/** Returns a read-only view of staged operations (for prepare/preview) */
	getStagedOperations(): ReadonlyArray<Operation<GenericConfig>> {
		return this.stagedOperations
	}

	/** Free staged operations from memory */
	clearStagedOperations(): void {
		this.stagedOperations = []
	}

	/** Free cached records from memory */
	clearRecordCache(): void {
		this.recordCache.clear()
	}

	/**
	 * Commit all staged operations to the store atomically.
	 * Called by Document.transaction() after user callback completes.
	 *
	 * Updates documentState (activity, progress, lastCommit).
	 * Merges operations by ID to optimize database writes.
	 */
	async commit(): Promise<void> {
		await commitTransaction({
			stagedOperations: this.stagedOperations,
			store: this.store,
			documentState: this.documentState,
		})
	}
}
