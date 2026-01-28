import { isFullAttributeArray } from './guard'

import type {
	RawRecord,
	ChainRecord,
	TreeRecord,
	AnyDialecteConfig,
	ElementsOf,
	FullAttributeObjectOf,
	AttributesValueObjectOf,
	OperationStatus,
} from '@/types'

/**
 * Converts a ChainRecord | TreeRecord to RawRecord
 * If already a RawRecord, returns as-is.
 */
export function toRawRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record:
		| RawRecord<GenericConfig, GenericElement>
		| ChainRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>,
): RawRecord<GenericConfig, GenericElement> {
	return {
		id: record.id,
		tagName: record.tagName,
		namespace: record.namespace,
		attributes: record.attributes,
		value: record.value,
		parent: record.parent,
		children: record.children,
	}
}

/**
 * Converts a RawRecord | TreeRecord to ChainRecord
 * If already a ChainRecord, returns as-is.
 */
export function toChainRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record:
		| RawRecord<GenericConfig, GenericElement>
		| ChainRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>
	status?: OperationStatus
}): ChainRecord<GenericConfig, GenericElement> {
	const { record, status } = params
	const consolidatedStatus = status ?? ('status' in record ? record.status : 'unchanged')

	return {
		...toRawRecord(record),
		status: consolidatedStatus,
	}
}

/**
 * Converts a RawRecord | ChainRecord to TreeRecord
 * If already a TreeRecord, returns as-is.
 */
export function toTreeRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record:
		| RawRecord<GenericConfig, GenericElement>
		| ChainRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>
	status?: OperationStatus
	tree?: TreeRecord<GenericConfig, GenericElement>[]
}): TreeRecord<GenericConfig, GenericElement> {
	const { record, status, tree } = params

	const consolidatedTree = tree ?? ('tree' in record ? record.tree : [])

	return {
		...toChainRecord({ record, status }),
		tree: consolidatedTree,
	} as TreeRecord<GenericConfig, GenericElement>
}

/**
 * Converts attributes to FullAttributeObject array format.
 * If already an array, returns as-is.
 * If object format, converts to array (without namespace since not available in object format).
 */
export function toFullAttributeArray<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tagName: GenericElement
	attributes:
		| AttributesValueObjectOf<GenericConfig, GenericElement>
		| FullAttributeObjectOf<GenericConfig, GenericElement>[]
	dialecteConfig: GenericConfig
}): FullAttributeObjectOf<GenericConfig, GenericElement>[] {
	const { tagName, attributes, dialecteConfig } = params
	if (isFullAttributeArray(attributes)) return attributes

	return Object.entries(attributes).map(
		([name, value]) =>
			({
				name,
				value,
				namespace:
					dialecteConfig.definition[tagName]?.attributes.details[name]?.namespace || undefined,
			}) as FullAttributeObjectOf<GenericConfig, GenericElement>,
	)
}
