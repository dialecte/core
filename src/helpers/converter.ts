import { isFullAttributeArray } from './guard'

import { invariant } from '@/utils'

import type {
	RawRecord,
	TrackedRecord,
	TreeRecord,
	AnyDialecteConfig,
	ElementsOf,
	FullAttributeObjectOf,
	AttributesValueObjectOf,
	OperationStatus,
	ParentRelationship,
	ChildRelationship,
	Ref,
	RefOrRecord,
} from '@/types'

/**
 * Converts a TrackedRecord | TreeRecord to RawRecord
 * If already a RawRecord, returns as-is.
 */
export function toRawRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
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
 * Converts a RawRecord | TreeRecord to TrackedRecord
 * If already a TrackedRecord, returns as-is.
 */
export function toTrackedRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>
	status?: OperationStatus
}): TrackedRecord<GenericConfig, GenericElement> {
	const { record, status } = params
	const consolidatedStatus = status ?? ('status' in record ? record.status : 'unchanged')

	return {
		...toRawRecord(record),
		status: consolidatedStatus,
	}
}

/**
 * Converts a RawRecord | TrackedRecord to TreeRecord
 * If already a TreeRecord, returns as-is.
 */
export function toTreeRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>
	status?: OperationStatus
	tree?: TreeRecord<GenericConfig, GenericElement>[]
}): TreeRecord<GenericConfig, GenericElement> {
	const { record, status, tree } = params

	const consolidatedTree = tree ?? ('tree' in record ? record.tree : [])

	return {
		...toTrackedRecord({ record, status }),
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
	dialecteConfig: GenericConfig
	tagName: GenericElement
	attributes:
		| Partial<AttributesValueObjectOf<GenericConfig, GenericElement>>
		| Partial<FullAttributeObjectOf<GenericConfig, GenericElement>>[]
}): FullAttributeObjectOf<GenericConfig, GenericElement>[] {
	const { dialecteConfig, tagName, attributes } = params
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

/**
 * Convert a Ref, ParentRelationship, ChildRelationship, or Record to a Ref.
 * ParentsOf/ChildrenOf are subsets of ElementsOf by design, so this is semantically safe.
 */
export function toRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(input: Ref<GenericConfig, GenericElement> | undefined): Ref<GenericConfig, GenericElement>
export function toRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	input:
		| ParentRelationship<GenericConfig, GenericElement>
		| ChildRelationship<GenericConfig, GenericElement>
		| undefined,
): Ref<GenericConfig, GenericElement>
export function toRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	input:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>
		| undefined,
): Ref<GenericConfig, GenericElement>
export function toRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(input: RefOrRecord<GenericConfig, GenericElement> | undefined): Ref<GenericConfig, GenericElement>
export function toRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	input:
		| Ref<GenericConfig, GenericElement>
		| ParentRelationship<GenericConfig, GenericElement>
		| ChildRelationship<GenericConfig, GenericElement>
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>
		| undefined,
): Ref<GenericConfig, GenericElement> {
	invariant(input, {
		detail: 'The record or ref is undefined',
	})

	return {
		id: input.id,
		tagName: input.tagName as GenericElement,
	} as Ref<GenericConfig, GenericElement>
}
