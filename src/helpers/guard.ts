import type {
	RawRecord,
	TrackedRecord,
	AnyDialecteConfig,
	ElementsOf,
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
 * Type guard to check if attributes are in array format (FullAttributeObject[])
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
 * Type guard to check if a record is a RawRecord (database record without API extensions)
 */
export function isRawRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(record: unknown): record is RawRecord<GenericConfig, GenericElement> {
	return hasExactKeys(record, RAW_RECORD_KEYS)
}

/**
 * Type guard to check if a record is a TrackedRecord
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
 * Type guard to check if a record is a TreeRecord
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
 * @example
 * if (record.parent && isParentOf(record.parent, 'Root')) { ... }
 */
export function isParentOf<T extends string>(
	parent: AnyRelationship,
	tagName: T,
): parent is AnyRelationship & { tagName: T } {
	return parent.tagName === tagName
}
