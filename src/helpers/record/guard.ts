import type {
	RawRecord,
	ChainRecord,
	AnyDialecteConfig,
	ElementsOf,
	FullAttributeObjectOf,
	AttributesValueObjectOf,
	TreeRecord,
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
const CHAIN_RECORD_KEYS = [...RAW_RECORD_KEYS, 'status'] as const
const TREE_RECORD_KEYS = [...CHAIN_RECORD_KEYS, 'tree'] as const

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
 * Type guard to check if a record is an ChainRecord
 */
export function isChainRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record:
		| RawRecord<GenericConfig, GenericElement>
		| ChainRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>,
): record is ChainRecord<GenericConfig, GenericElement> {
	return hasExactKeys(record, CHAIN_RECORD_KEYS)
}

/**
 * Type guard to check if a record is an TreeRecord
 */
export function isTreeRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record:
		| RawRecord<GenericConfig, GenericElement>
		| ChainRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>,
): record is TreeRecord<GenericConfig, GenericElement> {
	return hasExactKeys(record, TREE_RECORD_KEYS)
}
