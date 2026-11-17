import { NOOP_PROGRESS_REPORTER } from '../progress'
import { createStagedOperations } from '../staged-operations'
import { AnyQuery } from './any'
import {
	findAncestors,
	findAncestorsOfEach,
	findByAttributes,
	findDescendants,
	findDescendantsOfEach,
} from './find'
import { getDefinition, getTree } from './get'
import {
	getAttribute,
	getAttributes,
	getAttributeFullObject,
	getAttributesFullObject,
} from './get/attribute'
import {
	getRecord,
	getRecords,
	getRecordsByTagName,
	getChild,
	getChildren,
	getChildrenOfEach,
} from './get/record'
import { getSnapshot } from './snapshot'
import { ValidateQuery } from './validate'

import { toRef } from '@/helpers'
import { NOOP_PERF } from '@/perf'
import { invariant } from '@/utils'

import type { Context, StagedOperations } from '../types'
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
import type { Perf } from '@/perf'
import type { DocumentRecord } from '@/project'
import type { Store } from '@/store'
import type {
	AnyDialecteConfig,
	AnyTreeRecord,
	AttributesOf,
	ChildrenOf,
	DescendantsOf,
	ResolvedDefinition,
	ElementsOf,
	FullAttributeObjectOf,
	AttributesValueObjectOf,
	NamespacedAttributesValueObjectOf,
	NamespaceKeysUsedByElement,
	RootElementOf,
	TrackedRecord,
	TreeRecord,
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
	protected _perf: Perf
	private _any?: AnyQuery<GenericConfig>
	private _validate?: ValidateQuery<GenericConfig>

	constructor(
		store: Store,
		dialecteConfig: GenericConfig,
		documentId: string,
		perf: Perf = NOOP_PERF,
	) {
		this.store = store
		this.dialecteConfig = dialecteConfig
		this.documentId = documentId
		this._perf = perf
	}

	/** Dev-only perf helper (real when `dev.perf` is on, else a frozen no-op). */
	get perf(): Perf {
		return this._perf
	}

	//== Untyped namespace

	get any(): AnyQuery<GenericConfig> {
		return (this._any ??= new AnyQuery(() => this.context, this.dialecteConfig))
	}

	//== Validation namespace

	/** What the schema says of values, on the state this query sees (a transaction's staged writes included): `validate.value(...)`. */
	get validate(): ValidateQuery<GenericConfig> {
		return (this._validate ??= new ValidateQuery(() => this.context, this.dialecteConfig))
	}

	//== Context

	/**
	 * Override point for Transaction: returns the staged operations to overlay.
	 * Query has none — returns a fresh empty container. Transaction returns its own.
	 */
	protected getOperations(): StagedOperations<GenericConfig> {
		return createStagedOperations()
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
			progress: NOOP_PROGRESS_REPORTER,
			perf: this.perf,
		}
	}

	//== Document lookup

	/**
	 * Get the full metadata record of this document.
	 *
	 * @intent read the document name or extension, get document metadata, find which config a document uses
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
	 * @intent get the root element, start a walk from the top of the document
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
	 * Get a single record by ref, record, or relationship, in one store read.
	 *
	 * @intent load one element by id, resolve a ref or parent/child relationship to its record, refresh a record
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
	 * The definition of an element in its context: the declaration its parent holds when the schema
	 * declares the tag several ways, and what the type it names with xsi:type lets it hold.
	 *
	 * @intent read the schema definition of an element, list allowed attributes or enumeration values, know what an xsi:type lets an element hold
	 *
	 * @param refOrRecord - The element to describe; its record is fetched, so its parent is known.
	 * @returns The `ResolvedDefinition`, or `undefined` when nothing is found.
	 *
	 * @example
	 * ```ts
	 * const definition = await query.getDefinition(p)
	 * definition?.attributes.details.type?.type?.facets?.enumeration // as declared under p's parent
	 * ```
	 */
	async getDefinition<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
	): Promise<ResolvedDefinition | undefined> {
		return getDefinition({ context: this.context, ref: toRef(refOrRecord) })
	}

	/**
	 * Get multiple records in a single call.
	 *
	 * @intent load several elements by ref at once, resolve a list of children or relationships in one batched read
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
	 * Get the first direct child of an element matching a given tag name; it looks one level down only.
	 *
	 * @intent get one direct child by tag name, check whether a child exists
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
	 * Get all direct children of an element matching a given tag name; it looks one level down only, no recursion.
	 *
	 * @intent list direct children of one tag name, iterate one level below an element
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
	 * The children of a given tag of each parent, looked up through transparent elements as `getChildren` does, in at
	 * most three reads whatever the number of parents; a record given is used as given (no re-read). A parent
	 * ref without an id costs its own `getByTagName`.
	 *
	 * @intent read the children of many elements at once, the children of each of many parents
	 *
	 * @param refsOrRecords - The parent elements, in any order, repeats allowed.
	 * @param params.tagName - The child element type to look for.
	 * @returns One list of children per input position, in the input order; `[]` for a parent that does not exist.
	 *
	 * @example
	 * ```ts
	 * const [ofA1, ofA2] = await query.getChildrenOfEach([a1, a2], { tagName: 'AA_1' })
	 * ```
	 */
	async getChildrenOfEach<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
	>(
		refsOrRecords: ReadonlyArray<RefOrRecord<GenericConfig, GenericElement>>,
		params: { tagName: GenericChildElement },
	): Promise<TrackedRecord<GenericConfig, GenericChildElement>[][]> {
		return getChildrenOfEach({ context: this.context, refsOrRecords, tagName: params.tagName })
	}

	/**
	 * Get all records of a given tag name in the whole document, read from the tag index: the cheapest
	 * whole-document scan.
	 *
	 * @intent list every element of a tag in the whole document, scan all elements of one type regardless of position
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
	 * Find all descendants of an element, grouped by tag name, never in document order: walk a `getTree`
	 * result for document order.
	 *
	 * The groups are keyed by tag name. Under an element that is not the document root, a flat collect
	 * answers each group in id order; under the document root, and for the path form, in the store's own
	 * order.
	 *
	 * Reads: under an element that is not the document root, a flat collect reads the subtree top-down,
	 * one store read per level, only the branches that can hold a collected tag (content the definition
	 * does not list - an unknown element, xs:any content, a transparent element - is followed). Under the
	 * document root it reads each tag name's records from the store's tag index (climbing their parent
	 * chains when `omit` is given). The path form reads level by level; once a call has issued more store
	 * reads than one whole-document read is worth for this document (never before 128), it reads the
	 * document once and serves the rest from memory. For many elements at once, `findDescendantsOfEach`.
	 *
	 * @intent collect descendants of given tag names under an element, find nested elements at any depth below a scope
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
	 * What `findDescendants` answers for each element given, in one walk: a record given used as given, the refs in one
	 * store read, then one read per level over every element's subtree at once.
	 *
	 * @intent collect descendants under many scope elements at once
	 *
	 * @param refsOrRecords - The scope elements, in any order, repeats allowed.
	 * @param options - Collect spec and optional omit list, as `findDescendants` takes them, applied under each element.
	 * @returns One answer per input position, in the input order, each shaped as `findDescendants` answers.
	 *
	 * @example
	 * ```ts
	 * const [underA1, underB1] = await query.findDescendantsOfEach([a1, b1], { collect: 'AAA_1' })
	 * ```
	 */
	async findDescendantsOfEach<
		GenericElement extends ElementsOf<GenericConfig>,
		GenericCollect extends Collect<GenericConfig, GenericElement>,
	>(
		refsOrRecords: ReadonlyArray<RefOrRecord<GenericConfig, GenericElement>>,
		options: FindDescendantsParams<GenericConfig, GenericElement, GenericCollect>,
	): Promise<FindDescendantsReturn<GenericConfig, GenericElement, GenericCollect>[]> {
		return findDescendantsOfEach<GenericConfig, GenericElement, GenericCollect>({
			context: this.context,
			refsOrRecords,
			options,
		})
	}

	/**
	 * Walk the parent chain from an element upward, one store read per step; for the parent alone,
	 * `getRecord(record.parent)` is enough.
	 *
	 * @intent list the ancestors of an element, find the enclosing element of a tag, build a path from the root
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
	 * The ancestors of each element, in one read per ancestor level: ancestors shared by several elements are read
	 * once. A record given is used as given (its `parent` is followed, it is not read again); a ref is read, all
	 * refs in one read.
	 *
	 * @intent find the ancestors of many elements at once, build paths for a list of elements, group elements by an ancestor
	 *
	 * @param refsOrRecords - The starting elements (not included in results), in any order, repeats allowed.
	 * @param options - Depth limit, stop-at tag name (inclusive) and order, applied to each element as `findAncestors` does.
	 * @returns One ancestor list per input position, in the input order; `[]` for a ref that names no element.
	 *
	 * @example
	 * ```ts
	 * const [ofAaa1, ofBbb1] = await query.findAncestorsOfEach([aaa1, bbb1], { order: 'top-down' })
	 * // [[Root, A, AA_1], [Root, B, BB_1]]
	 * ```
	 */
	async findAncestorsOfEach<GenericElement extends ElementsOf<GenericConfig>>(
		refsOrRecords: ReadonlyArray<RefOrRecord<GenericConfig, GenericElement>>,
		options?: FindAncestorsOptions<GenericConfig>,
	): Promise<TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[][]> {
		return findAncestorsOfEach({ context: this.context, refsOrRecords, options })
	}

	/**
	 * Build a full tree structure from an element down. It reads only the branches it can keep when a
	 * `select`, a tag-only `omit` or a `depth` prunes (one read per level), else the whole document once.
	 *
	 * @intent read a subtree in document order, walk children recursively, project a filtered tree with select or omit, read a subtree to copy it with deepClone
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
	 * Snapshot the (uncommitted) document state as a tree, XML string, or both: a view that includes
	 * staged changes. The stored file, to save or download, comes from `project.export`.
	 *
	 * Reads overlay staged operations, so calling this on a live transaction or a
	 * prepared transaction's `query` reflects exactly what `commit()` would write.
	 * Scope is controlled by `ref`/`ancestors`/`siblings`/`depth`; output by `as`.
	 *
	 * @intent preview what a transaction would commit, read staged changes as XML or as a tree, show what a prepared transaction would produce
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
	 * Read a single attribute value of an element (a ref, a record or a relationship).
	 *
	 * @intent read an attribute of an element, read one attribute value, read a namespaced attribute, read an attribute with its schema default
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
		const { fullObject } = params
		if (fullObject)
			return getAttributeFullObject({ context: this.context, ref: refOrRecord, ...params })
		return getAttribute({ context: this.context, ref: refOrRecord, ...params })
	}

	/**
	 * Read an element's attributes as a destructurable value object, each under the name it is stored by - what a
	 * write takes back.
	 *
	 * @intent read the attributes of an element, read all attribute values of an element, destructure several attributes at once, read attributes of one namespace
	 *
	 * @param refOrRecord - The element to read from.
	 * @returns A `{ aA, bA, 'ext:cA', 'xsi:type', ... }` object: unprefixed in the default namespace, prefixed otherwise.
	 *
	 * @example
	 * ```ts
	 * const { aA, 'ext:cA': cA } = await query.getAttributes(a)
	 * ```
	 */
	async getAttributes<GenericElement extends ElementsOf<GenericConfig>>(
		refOrRecord: RefOrRecord<GenericConfig, GenericElement> | undefined,
		params?: { namespace?: undefined; fullObject?: false; defaults?: AttributeDefaults },
	): Promise<AttributesValueObjectOf<GenericConfig, GenericElement>>
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
		const { fullObject } = params || {}
		if (fullObject)
			return getAttributesFullObject({ context: this.context, ref: refOrRecord, ...params })
		return getAttributes({ context: this.context, ref: refOrRecord, ...params })
	}

	//== Find queries

	/**
	 * Find records of one tag matching specific attribute values: every attribute given (AND), any value of a list
	 * (OR). A list of values is one lookup, however long. A store that looks records up by attribute matches the plain
	 * attributes itself and reads only the matches; elsewhere every element of the tag is read and filtered. Same
	 * answer either way.
	 *
	 * @intent find elements by attribute value, look up an element by an identifying attribute, filter one tag's elements by attribute, look up many elements by a list of values in one call
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
