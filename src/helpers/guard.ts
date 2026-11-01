import type {
	RawRecord,
	TrackedRecord,
	AnyDialecteConfig,
	ElementsOf,
	AttributesOf,
	FullAttributeObjectOf,
	AttributesValueObjectOf,
	TreeRecord,
	AnyRawRecord,
	AnyTrackedRecord,
	AnyTreeRecord,
	AnyRelationship,
} from '@/types'

/**
 * Required keys for each record type
 */
const RAW_RECORD_KEYS = [
	'id',
	'tagName',
	'namespace',
	'attributes',
	'children',
	'parent',
	'value',
] as const
const TRACKED_RECORD_KEYS = [...RAW_RECORD_KEYS, 'status'] as const
const TREE_RECORD_KEYS = [...TRACKED_RECORD_KEYS, 'tree'] as const

/**
 * Helper to check if record has exact keys (no more, no less)
 */
function hasExactKeys(record: unknown, requiredKeys: readonly string[]): boolean {
	if (typeof record !== 'object' || record === null) {
		return false
	}

	const recordKeys = Object.keys(record)

	return (
		requiredKeys.every((key) => key in record) &&
		recordKeys.every((key) => requiredKeys.includes(key)) &&
		recordKeys.length === requiredKeys.length
	)
}

/**
 * Whether attributes come as an array of attribute objects (`FullAttributeObject[]`) rather than a value object.
 *
 * @intent tell an attribute array from an attribute value object, narrow attribute input
 */
export function isFullAttributeArray<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	attributes:
		| AttributesValueObjectOf<GenericConfig, GenericElement>
		| FullAttributeObjectOf<GenericConfig, GenericElement>[],
): attributes is FullAttributeObjectOf<GenericConfig, GenericElement>[] {
	return Array.isArray(attributes)
}

/**
 * Whether a record is a `RawRecord`: the stored shape, without a change status or tree children.
 *
 * @intent tell a stored record from a tracked or tree record, narrow a record to its raw shape
 */
export function isRawRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(record: unknown): record is RawRecord<GenericConfig, GenericElement> {
	return hasExactKeys(record, RAW_RECORD_KEYS)
}

/**
 * Whether a record is a `TrackedRecord`: a stored record with its change status, as queries return it.
 *
 * @intent tell a tracked record from a raw or tree record, narrow a record to its tracked shape
 */
export function isTrackedRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>,
): record is TrackedRecord<GenericConfig, GenericElement> {
	return hasExactKeys(record, TRACKED_RECORD_KEYS)
}

/**
 * Whether a record is a `TreeRecord`: a node of a tree read, holding its child nodes.
 *
 * @intent tell a tree record from a raw or tracked record, narrow a record to a tree node
 */
export function isTreeRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>,
): record is TreeRecord<GenericConfig, GenericElement> {
	return hasExactKeys(record, TREE_RECORD_KEYS)
}

/**
 * Whether a record is of the tag name given, narrowing its type to that element (raw, tracked or tree record alike).
 *
 * @intent narrow a record to one tag name, check an element's tag with types
 */
export function isRecordOf<
	GenericConfig extends AnyDialecteConfig,
	GenericTagName extends ElementsOf<GenericConfig>,
>(
	record: TreeRecord<GenericConfig, ElementsOf<GenericConfig>>,
	tagName: GenericTagName,
): record is TreeRecord<GenericConfig, GenericTagName>
export function isRecordOf<
	GenericConfig extends AnyDialecteConfig,
	GenericTagName extends ElementsOf<GenericConfig>,
>(
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>,
	tagName: GenericTagName,
): record is TrackedRecord<GenericConfig, GenericTagName>
export function isRecordOf<
	GenericConfig extends AnyDialecteConfig,
	GenericTagName extends ElementsOf<GenericConfig>,
>(
	record: RawRecord<GenericConfig, ElementsOf<GenericConfig>>,
	tagName: GenericTagName,
): record is RawRecord<GenericConfig, GenericTagName>
export function isRecordOf(
	record: AnyRawRecord | AnyTrackedRecord | AnyTreeRecord,
	tagName: string,
): boolean {
	return record.tagName === tagName
}

/**
 * Type predicate narrowing a relationship to a specific tag name.
 *
 * @intent filter child refs by tag name, narrow a child relationship to one tag
 *
 * @example
 * const aa1Refs = recordA.children.filter((child) => isChildOf(child, 'AA_1'))
 * const aa1Elements = await query.getRecords(aa1Refs) // TrackedRecord<Config, 'AA_1'>[]
 */
export function isChildOf<T extends string>(
	child: AnyRelationship,
	tagName: T,
): child is AnyRelationship & { tagName: T } {
	return child.tagName === tagName
}

/**
 * Type predicate narrowing a parent relationship to a specific tag name.
 *
 * @intent check the tag of a record's parent, narrow a parent relationship to one tag
 *
 * @example
 * if (record.parent && isParentOf(record.parent, 'Root')) { ... }
 */
export function isParentOf<T extends string>(
	parent: AnyRelationship,
	tagName: T,
): parent is AnyRelationship & { tagName: T } {
	return parent.tagName === tagName
}

/**
 * Type predicate narrowing a string to a valid element tag name for a given config.
 *
 * @intent check that a string is a tag name of the dialecte, narrow an unknown tag name before a typed query
 *
 * @example
 * if (isElementOf<MyConfig>(tagName, dialecteConfig)) {
 *   const records = await query.getRecordsByTagName(tagName) // fully typed
 * }
 */
export function isElementOf<GenericConfig extends AnyDialecteConfig>(
	tagName: string,
	dialecteConfig: GenericConfig,
): tagName is ElementsOf<GenericConfig> {
	return (dialecteConfig.elements as readonly string[]).includes(tagName)
}

/**
 * Type predicate narrowing a string to a valid attribute name for a given record.
 *
 * @intent check that a string is an attribute of an element, narrow an attribute name before a typed read
 *
 * @example
 * if (isAttributeOf(record, entry.uuidAttr)) {
 *   const value = await query.getAttribute(record, entry.uuidAttr) // fully typed
 * }
 */
export function isAttributeOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>,
	name: string,
): name is AttributesOf<GenericConfig, GenericElement> {
	return record.attributes.some((attribute) => attribute.name === name)
}
