import { findByAttributes, findDescendants } from './find'
import { getTree } from './get'
import {
	getAttribute,
	getAttributes,
	getAttributeFullObject,
	getAttributesFullObject,
} from './get/attribute'
import { getRecord, getRecords, getRecordsByTagName } from './get/record'

import { toRef } from '@/helpers'

import type { Context } from '../types'
import type { FilterAttributes, DescendantsFilter, FindDescendantsReturn } from './find'
import type { GetTreeParams } from './get'
import type { Store } from '@/store'
import type {
	AnyDialecteConfig,
	AttributesOf,
	AttributesValueObjectOf,
	ElementsOf,
	FullAttributeObjectOf,
	TrackedRecord,
	TreeRecord,
	Operation,
	Ref,
	RefOrRecord,
	RootElementOf,
} from '@/types'

/**
 * Query — query-only access to a dialecte's store.
 *
 * Single source of truth for all read operations.
 * Transaction extends this to overlay staged ops.
 * Document exposes this via doc.query for direct store reads.
 *
 * Subclass in a dialecte (e.g. SclQuery) to add domain-specific queries.
 */
export class Query<GenericConfig extends AnyDialecteConfig> {
	protected store: Store
	protected dialecteConfig: GenericConfig

	constructor(store: Store, dialecteConfig: GenericConfig) {
		this.store = store
		this.dialecteConfig = dialecteConfig
	}

	//== Context

	/**
	 * Override point for Transaction: returns staged operations to overlay.
	 * Query returns [] — no staged ops. Transaction returns its stagedOperations.
	 */
	protected getOperations(): Operation<GenericConfig>[] {
		return []
	}

	/**
	 * Read-only context passed to record FP functions.
	 * Expose as `protected` so dialecte subclasses (e.g. SclQuery) can call
	 * the same FP functions for domain-specific queries.
	 */
	protected get context(): Context<GenericConfig> {
		return {
			store: this.store,
			recordCache: undefined,
			stagedOperations: this.getOperations(),
		}
	}

	//== Record lookup

	async getRoot(): Promise<TrackedRecord<GenericConfig, RootElementOf<GenericConfig>> | undefined> {
		return getRecord({
			context: this.context,
			ref: { tagName: this.dialecteConfig.rootElementName } as Ref<
				GenericConfig,
				RootElementOf<GenericConfig>
			>,
		})
	}

	async getRecord<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
	): Promise<TrackedRecord<GenericConfig, GenericElement> | undefined> {
		return getRecord({ context: this.context, ref: toRef(refOrRecord) })
	}

	async getRecords<GenericElement extends ElementsOf<GenericConfig>>(
		refsOrRecords: (RefOrRecord<GenericConfig, GenericElement> | undefined)[],
	): Promise<(TrackedRecord<GenericConfig, GenericElement> | undefined)[]> {
		const refs = refsOrRecords.map((record) => toRef(record))
		return getRecords({ context: this.context, refs })
	}

	async getRecordsByTagName<GenericElement extends ElementsOf<GenericConfig>>(
		tagName: GenericElement,
	): Promise<TrackedRecord<GenericConfig, GenericElement>[]> {
		return getRecordsByTagName({ context: this.context, tagName })
	}

	async findDescendants<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericFilter extends DescendantsFilter<GenericConfig> | undefined = undefined,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		filter?: GenericFilter,
	): Promise<FindDescendantsReturn<GenericConfig, GenericElement, GenericFilter>> {
		return findDescendants({
			context: this.context,
			dialecteConfig: this.dialecteConfig,
			ref: toRef(refOrRecord),
			filter,
		})
	}

	async getTree<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		options?: GetTreeParams<GenericConfig, GenericElement>,
	): Promise<TreeRecord<GenericConfig, GenericElement> | undefined> {
		return getTree({ context: this.context, ref: toRef(refOrRecord), options })
	}

	//== Attribute queries

	/**
	 * @example
	 * await doc.query.getAttribute({ ref, name: 'name' })                    // → string | ''
	 * await doc.query.getAttribute({ ref, name: 'name', fullObject: true })  // → FullAttributeObject | undefined
	 */
	async getAttribute<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
		FullObject extends boolean = false,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: {
			name: AttributesOf<GenericConfig, GenericElement>
			fullObject?: FullObject
		},
	): Promise<GenericAttribute | undefined | GenericAttribute['value'] | ''> {
		const resolvedRef = toRef(refOrRecord)
		const { fullObject } = params
		if (fullObject)
			return getAttributeFullObject({ context: this.context, ref: resolvedRef, ...params })
		return getAttribute({ context: this.context, ref: resolvedRef, ...params })
	}

	/**
	 * @example
	 * const { name, desc } = await doc.query.getAttributes({ ref })                   // destructurable
	 * const fullAttrs      = await doc.query.getAttributes({ ref, fullObject: true }) // FullAttributeObject[]
	 */
	async getAttributes<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
		FullObject extends boolean = false,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params?: {
			fullObject?: FullObject
		},
	): Promise<GenericAttribute[] | AttributesValueObjectOf<GenericConfig, GenericElement>> {
		const resolvedRef = toRef(refOrRecord)
		const { fullObject } = params || {}
		if (fullObject)
			return getAttributesFullObject({ context: this.context, ref: resolvedRef, ...params })
		return getAttributes({ context: this.context, ref: resolvedRef, ...params })
	}

	//== Find queries

	async findByAttributes<GenericElement extends ElementsOf<GenericConfig>>(params: {
		tagName: GenericElement
		attributes: FilterAttributes<GenericConfig, GenericElement>
	}): Promise<TrackedRecord<GenericConfig, GenericElement>[]> {
		return findByAttributes({ context: this.context, ...params })
	}
}
