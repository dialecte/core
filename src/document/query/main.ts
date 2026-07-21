import { AnyQuery } from './any'
import { findAncestors, findByAttributes, findDescendants } from './find'
import { getTree } from './get'
import {
	getAttribute,
	getAttributes,
	getAttributeFullObject,
	getAttributesFullObject,
} from './get/attribute'
import { getRecord, getRecords, getRecordsByTagName, getChild, getChildren } from './get/record'
import { getSnapshot } from './snapshot'

import { toRef } from '@/helpers'
import { invariant } from '@/utils'

import type { Context } from '../types'
import type {
	FindAncestorsOptions,
	FilterAttributes,
	Collect,
	FindDescendantsParams,
	FindDescendantsReturn,
} from './find'
import type { GetTreeParams } from './get'
import type { GetSnapshotOptions, SnapshotResult } from './snapshot'
import type { Ref, RefOrRecord } from '@/document'
import type { DocumentRecord } from '@/project'
import type { Store } from '@/store'
import type {
	AnyDialecteConfig,
	AnyTreeRecord,
	AttributesOf,
	DefaultAttributesValueObjectOf,
	DescendantsOf,
	ElementsOf,
	ChildrenOf,
	FullAttributeObjectOf,
	NamespacedAttributesValueObjectOf,
	NamespaceKeysUsedByElement,
	TrackedRecord,
	TreeRecord,
	Operation,
	RootElementOf,
} from '@/types'
import type { AttributeDefaults } from '@/utils'

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
	protected documentId: string
	private _any?: AnyQuery<GenericConfig>

	constructor(store: Store, dialecteConfig: GenericConfig, documentId: string) {
		this.store = store
		this.dialecteConfig = dialecteConfig
		this.documentId = documentId
	}

	//== Untyped namespace

	get any(): AnyQuery<GenericConfig> {
		return (this._any ??= new AnyQuery(() => this.context, this.dialecteConfig))
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
			dialecteConfig: this.dialecteConfig,
			documentId: this.documentId,
			recordCache: undefined,
			stagedOperations: this.getOperations(),
		}
	}

	//== Document lookup

	/**
	 * Get the full metadata record of this document.
	 *
	 * @returns The document record: `id`, `name`, `extension`, `configKey`,
	 *   `createdAt`, and optional `metadata`.
	 *
	 * @example
	 * ```ts
	 * const { name, extension } = await query.getDocumentInfo()
	 * ```
	 */
	async getDocumentInfo(): Promise<DocumentRecord> {
		const document = await this.store.getDocument(this.documentId)
		invariant(document, {
			key: 'DOCUMENT_NOT_REGISTERED',
			detail: `Expected document id: ${this.documentId}`,
		})
		return document
	}

	//== Record lookup

	/**
	 * Get the root element of the document.
	 *
	 * @returns The root record.
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

		invariant(root, {
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
	 * const a = await query.getRecord({ tagName: 'A', id: knownId })
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
	 * const [a1, a2] = await query.getRecords([ref1, ref2])
	 * ```
	 */
	async getRecords<GenericElement extends ElementsOf<GenericConfig>>(
		refsOrRecords: (RefOrRecord<GenericConfig, GenericElement> | undefined)[],
	): Promise<(TrackedRecord<GenericConfig, GenericElement> | undefined)[]> {
		const refs = refsOrRecords.map((record) => toRef(record))
		return getRecords({ context: this.context, refs })
	}

	/**
	 * Get the first direct child of an element matching a given tag name.
	 *
	 * @param refOrRecord - The parent element.
	 * @param tagName - The child element type to look for.
	 * @returns The first matching child record, or `undefined` if none.
	 *
	 * @example
	 * ```ts
	 * const aa1 = await query.getChild(a, 'AA_1')
	 * ```
	 */
	async getChild<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		tagName: GenericChildElement,
	): Promise<TrackedRecord<GenericConfig, GenericChildElement> | undefined> {
		if (!refOrRecord) return undefined
		return getChild({ context: this.context, ref: toRef(refOrRecord), tagName })
	}

	/**
	 * Get all direct children of an element matching a given tag name.
	 *
	 * @param refOrRecord - The parent element.
	 * @param tagName - The child element type to look for.
	 * @returns All matching child records.
	 *
	 * @example
	 * ```ts
	 * const children = await query.getChildren(a, 'AA_1')
	 * ```
	 */
	async getChildren<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		tagName: GenericChildElement,
	): Promise<TrackedRecord<GenericConfig, GenericChildElement>[]> {
		if (!refOrRecord) return []
		return getChildren({ context: this.context, ref: toRef(refOrRecord), tagName })
	}

	/**
	 * Get all records of a given tag name.
	 *
	 * @param tagName - The element type to retrieve.
	 * @returns All tracked records matching that tag name.
	 *
	 * @example
	 * ```ts
	 * const records = await query.getRecordsByTagName('A')
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
	 * @param options - Collect spec and optional omit list. When omitted, collects all descendant tag names.
	 * @returns Object keyed by tag name, each value an array of tracked records.
	 *
	 * @example
	 * ```ts
	 * // All descendants
	 * const all = await query.findDescendants(a)
	 * // Specific collect
	 * const { AA_1 } = await query.findDescendants(a, { collect: 'AA_1' })
	 * ```
	 */
	async findDescendants<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
	): Promise<
		Partial<
			Record<
				DescendantsOf<GenericConfig, GenericElement>,
				TrackedRecord<GenericConfig, DescendantsOf<GenericConfig, GenericElement>>[]
			>
		>
	>
	async findDescendants<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericCollect extends Collect<GenericConfig, GenericElement>,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		options: FindDescendantsParams<GenericConfig, GenericElement, GenericCollect>,
	): Promise<FindDescendantsReturn<GenericConfig, GenericElement, GenericCollect>>
	async findDescendants<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericCollect extends Collect<GenericConfig, GenericElement>,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		options?: FindDescendantsParams<GenericConfig, GenericElement, GenericCollect>,
	): Promise<unknown> {
		const ref = toRef(refOrRecord)
		if (!options) {
			const collectAll = (this.dialecteConfig.descendants[ref.tagName] ??
				[]) as unknown as GenericCollect
			return findDescendants({
				context: this.context,
				ref,
				options: { collect: collectAll } as FindDescendantsParams<
					GenericConfig,
					GenericElement,
					GenericCollect
				>,
			})
		}
		return findDescendants({
			context: this.context,
			ref,
			options,
		})
	}

	/**
	 * Walk the parent chain from an element upward.
	 *
	 * @param refOrRecord - The starting element (not included in results).
	 * @param options - Optional depth limit or stop-at tag name.
	 * @returns Ancestors bottom-up: [parent, grandparent, …, root]. Stop element is included.
	 *
	 * @example
	 * ```ts
	 * const ancestors = await query.findAncestors(aa1)
	 * // [A, Root]
	 * ```
	 */
	async findAncestors<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		options?: FindAncestorsOptions<GenericConfig>,
	): Promise<TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
		if (!refOrRecord) return []
		return findAncestors({ context: this.context, ref: toRef(refOrRecord), options })
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
	 * const tree = await query.getTree(a)
	 * ```
	 */
	async getTree<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		options?: GetTreeParams<GenericConfig, GenericElement>,
	): Promise<TreeRecord<GenericConfig, GenericElement> | undefined> {
		return getTree({
			context: this.context,
			ref: toRef(refOrRecord),
			options,
			dialecteConfig: this.dialecteConfig,
		})
	}

	/**
	 * Snapshot the (uncommitted) document state as a tree, XML string, or both.
	 *
	 * Reads overlay staged operations, so calling this on a live transaction or a
	 * prepared transaction's `query` reflects exactly what `commit()` would write.
	 * Scope is controlled by `ref`/`ancestors`/`siblings`/`depth`; output by `as`.
	 *
	 * @example
	 * ```ts
	 * const prepared = await doc.prepare(async (tx) => tx.addChild(parent, payload))
	 * const { tree, xmlString } = await prepared.query.getSnapshot({ as: 'both' })
	 * ```
	 */
	async getSnapshot<GenericElement extends ElementsOf<GenericConfig>>(
		options?: GetSnapshotOptions<GenericConfig, GenericElement> & { as?: 'tree' },
	): Promise<AnyTreeRecord>
	async getSnapshot<GenericElement extends ElementsOf<GenericConfig>>(
		options: GetSnapshotOptions<GenericConfig, GenericElement> & { as: 'xml' },
	): Promise<string>
	async getSnapshot<GenericElement extends ElementsOf<GenericConfig>>(
		options: GetSnapshotOptions<GenericConfig, GenericElement> & { as: 'both' },
	): Promise<SnapshotResult>
	async getSnapshot<GenericElement extends ElementsOf<GenericConfig>>(
		options?: GetSnapshotOptions<GenericConfig, GenericElement>,
	): Promise<AnyTreeRecord | string | SnapshotResult> {
		return getSnapshot({ context: this.context, options })
	}

	//== Attribute queries

	/**
	 * Get a single attribute value from a record.
	 *
	 * @param refOrRecord - The element to read from.
	 * @param params - Attribute `name` and an optional `namespace` scope. Without a
	 *   scope, `name` is a canonical attribute name; with a `namespace` key, `name`
	 *   is the local name within that namespace (`{ name: 'cA', namespace: 'ext' }`).
	 * @returns The attribute value, or `''` if absent.
	 *
	 * @example
	 * ```ts
	 * const val = await query.getAttribute(a, { name: 'aA' })
	 * const cA = await query.getAttribute(a, { name: 'cA', namespace: 'ext' })
	 * ```
	 */
	async getAttribute<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: {
			name: AttributesOf<GenericConfig, GenericElement> | (string & {})
			namespace?: NamespaceKeysUsedByElement<GenericConfig, GenericElement> | (string & {})
			fullObject?: false
			defaults?: AttributeDefaults
		},
	): Promise<FullAttributeObjectOf<GenericConfig, GenericElement>['value'] | ''>
	async getAttribute<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: {
			name: AttributesOf<GenericConfig, GenericElement> | (string & {})
			namespace?: NamespaceKeysUsedByElement<GenericConfig, GenericElement> | (string & {})
			fullObject: true
			defaults?: AttributeDefaults
		},
	): Promise<FullAttributeObjectOf<GenericConfig, GenericElement> | undefined>
	async getAttribute<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: {
			name: string
			namespace?: string
			fullObject?: boolean
			defaults?: AttributeDefaults
		},
	): Promise<GenericAttribute | undefined | GenericAttribute['value'] | ''> {
		const resolvedRef = toRef(refOrRecord)
		const { fullObject } = params
		if (fullObject)
			return getAttributeFullObject({ context: this.context, ref: resolvedRef, ...params })
		return getAttribute({ context: this.context, ref: resolvedRef, ...params })
	}

	/**
	 * Get a record's default-namespace attributes as a destructurable value object.
	 *
	 * @param refOrRecord - The element to read from.
	 * @returns A `{ aA, bA, ... }` object of the unprefixed attributes.
	 *
	 * @example
	 * ```ts
	 * const { aA } = await query.getAttributes(a)
	 * ```
	 */
	async getAttributes<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params?: { namespace?: undefined; fullObject?: false; defaults?: AttributeDefaults },
	): Promise<DefaultAttributesValueObjectOf<GenericConfig, GenericElement>>
	/**
	 * Get a record's attributes for a namespace scope, keyed by **local** name.
	 *
	 * @param refOrRecord - The element to read from.
	 * @param params - A `namespace` key (e.g. `'ext'`) whose attributes to return.
	 * @returns A `{ cA: '...' }` object with the namespace prefix stripped.
	 *
	 * @example
	 * ```ts
	 * const { cA } = await query.getAttributes(a, { namespace: 'ext' })
	 * ```
	 */
	async getAttributes<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericNamespaceKey extends NamespaceKeysUsedByElement<GenericConfig, GenericElement>,
	>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: { namespace: GenericNamespaceKey; fullObject?: false; defaults?: AttributeDefaults },
	): Promise<NamespacedAttributesValueObjectOf<GenericConfig, GenericElement, GenericNamespaceKey>>
	/**
	 * Get a record's attributes for a custom namespace scope not declared in the
	 * config, keyed by local name.
	 */
	async getAttributes<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: { namespace: string; fullObject?: false; defaults?: AttributeDefaults },
	): Promise<Record<string, string>>
	/**
	 * Get all attributes of a record as an array of full attribute objects.
	 *
	 * @param refOrRecord - The element to read from.
	 * @returns An array of full attribute objects.
	 *
	 * @example
	 * ```ts
	 * const fullAttributeObjects = await query.getAttributes(a, { fullObject: true })
	 * ```
	 */
	async getAttributes<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params: { fullObject: true; defaults?: AttributeDefaults },
	): Promise<FullAttributeObjectOf<GenericConfig, GenericElement>[]>
	async getAttributes<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params?: { namespace?: string; fullObject?: boolean; defaults?: AttributeDefaults },
	): Promise<Record<string, string> | FullAttributeObjectOf<GenericConfig, GenericElement>[]> {
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
	 * const records = await query.findByAttributes({
	 *   tagName: 'A',
	 *   attributes: { aA: 'val' },
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
