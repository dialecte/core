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
import { assert } from '@/utils'

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

	/**
	 * Get the root element of the document.
	 *
	 * @returns The root record, or `undefined` if the database is empty.
	 *
	 * @example
	 * ```ts
	 * const root = await query.getRoot()
	 * ```
	 */
	async getRoot(): Promise<TrackedRecord<GenericConfig, RootElementOf<GenericConfig>>> {
		const root = await getRecord({
			context: this.context,
			ref: { tagName: this.dialecteConfig.rootElementName } as Ref<
				GenericConfig,
				RootElementOf<GenericConfig>
			>,
		})

		assert(root, {
			key: 'ROOT_NOT_FOUND',
			detail: `Expected tag name: ${this.dialecteConfig.rootElementName}`,
		})
		return root
	}

	/**
	 * Get a single record by ref, record, or relationship.
	 *
	 * @param refOrRecord - A ref `{ tagName, id }`, or any record/relationship.
	 * @returns The tracked record, or `undefined` if not found.
	 *
	 * @example
	 * ```ts
	 * const ied = await query.getRecord({ tagName: 'IED', id: knownId })
	 * ```
	 */
	async getRecord<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
	): Promise<TrackedRecord<GenericConfig, GenericElement> | undefined> {
		return getRecord({ context: this.context, ref: toRef(refOrRecord) })
	}

	/**
	 * Get multiple records in a single call.
	 *
	 * @param refsOrRecords - Array of refs, records, or relationships.
	 * @returns Array of tracked records (same order, `undefined` for missing).
	 *
	 * @example
	 * ```ts
	 * const [bay1, bay2] = await query.getRecords([ref1, ref2])
	 * ```
	 */
	async getRecords<GenericElement extends ElementsOf<GenericConfig>>(
		refsOrRecords: (RefOrRecord<GenericConfig, GenericElement> | undefined)[],
	): Promise<(TrackedRecord<GenericConfig, GenericElement> | undefined)[]> {
		const refs = refsOrRecords.map((record) => toRef(record))
		return getRecords({ context: this.context, refs })
	}

	/**
	 * Get all records of a given tag name.
	 *
	 * @param tagName - The element type to retrieve.
	 * @returns All tracked records matching that tag name.
	 *
	 * @example
	 * ```ts
	 * const ieds = await query.getRecordsByTagName('IED')
	 * ```
	 */
	async getRecordsByTagName<GenericElement extends ElementsOf<GenericConfig>>(
		tagName: GenericElement,
	): Promise<TrackedRecord<GenericConfig, GenericElement>[]> {
		return getRecordsByTagName({ context: this.context, tagName })
	}

	/**
	 * Find all descendants of an element, grouped by tag name.
	 *
	 * @param refOrRecord - The ancestor element.
	 * @param filter - Optional filter to restrict which tag names are returned.
	 * @returns Object keyed by tag name, each value an array of tracked records.
	 *
	 * @example
	 * ```ts
	 * const { Bay, VoltageLevel } = await query.findDescendants(substation)
	 * ```
	 */
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

	/**
	 * Build a full tree structure from an element down.
	 *
	 * @param refOrRecord - The root of the subtree.
	 * @param options - Optional depth/filter controls.
	 * @returns A tree record with nested children, or `undefined` if not found.
	 *
	 * @example
	 * ```ts
	 * const tree = await query.getTree(bay)
	 * ```
	 */
	async getTree<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		options?: GetTreeParams<GenericConfig, GenericElement>,
	): Promise<TreeRecord<GenericConfig, GenericElement> | undefined> {
		return getTree({ context: this.context, ref: toRef(refOrRecord), options })
	}

	//== Attribute queries

	/**
	 * Get a single attribute value from a record.
	 *
	 * @param refOrRecord - The element to read from.
	 * @param params - Attribute name.
	 * @returns The attribute value, or `''` if absent.
	 *
	 * @example
	 * ```ts
	 * const name = await query.getAttribute(bay, { name: 'name' })
	 * ```
	 */
	async getAttribute<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: { name: AttributesOf<GenericConfig, GenericElement>; fullObject?: false },
	): Promise<FullAttributeObjectOf<GenericConfig, GenericElement>['value'] | ''>
	/**
	 * Get the full attribute object for a single attribute.
	 *
	 * @param refOrRecord - The element to read from.
	 * @param params - Attribute name and `fullObject: true`.
	 * @returns The full attribute object, or `undefined` if absent.
	 *
	 * @example
	 * ```ts
	 * const fullAttributeObject = await query.getAttribute(bay, { name: 'name', fullObject: true })
	 * ```
	 */
	async getAttribute<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: { name: AttributesOf<GenericConfig, GenericElement>; fullObject: true },
	): Promise<FullAttributeObjectOf<GenericConfig, GenericElement> | undefined>
	async getAttribute<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: {
			name: AttributesOf<GenericConfig, GenericElement>
			fullObject?: boolean
		},
	): Promise<GenericAttribute | undefined | GenericAttribute['value'] | ''> {
		const resolvedRef = toRef(refOrRecord)
		const { fullObject } = params
		if (fullObject)
			return getAttributeFullObject({ context: this.context, ref: resolvedRef, ...params })
		return getAttribute({ context: this.context, ref: resolvedRef, ...params })
	}

	/**
	 * Get all attributes of a record as a destructurable key/value object.
	 *
	 * @param refOrRecord - The element to read from.
	 * @returns A `{ name, desc, ... }` object with attribute names as keys.
	 *
	 * @example
	 * ```ts
	 * const { name, desc } = await query.getAttributes(bay)
	 * ```
	 */
	async getAttributes<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params?: { fullObject?: false },
	): Promise<AttributesValueObjectOf<GenericConfig, GenericElement>>
	/**
	 * Get all attributes of a record as an array of full attribute objects.
	 *
	 * @param refOrRecord - The element to read from.
	 * @returns An array of full attribute objects.
	 *
	 * @example
	 * ```ts
	 * const fullAttributeObjects = await query.getAttributes(bay, { fullObject: true })
	 * ```
	 */
	async getAttributes<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: { fullObject: true },
	): Promise<FullAttributeObjectOf<GenericConfig, GenericElement>[]>
	async getAttributes<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params?: { fullObject?: boolean },
	): Promise<GenericAttribute[] | AttributesValueObjectOf<GenericConfig, GenericElement>> {
		const resolvedRef = toRef(refOrRecord)
		const { fullObject } = params || {}
		if (fullObject)
			return getAttributesFullObject({ context: this.context, ref: resolvedRef, ...params })
		return getAttributes({ context: this.context, ref: resolvedRef, ...params })
	}

	//== Find queries

	/**
	 * Find records matching specific attribute values.
	 *
	 * @param params - Tag name and attribute filter criteria.
	 * @returns All matching tracked records.
	 *
	 * @example
	 * ```ts
	 * const bays = await query.findByAttributes({
	 *   tagName: 'Bay',
	 *   attributes: { name: 'Q01' },
	 * })
	 * ```
	 */
	async findByAttributes<GenericElement extends ElementsOf<GenericConfig>>(params: {
		tagName: GenericElement
		attributes: FilterAttributes<GenericConfig, GenericElement>
	}): Promise<TrackedRecord<GenericConfig, GenericElement>[]> {
		return findByAttributes({ context: this.context, ...params })
	}
}
