import { stageAddChild } from '../create/create'

import { getChildren, matchesAttributeFilter } from '@/document'

import type { AddChildParams, ChildAttributesOf } from '../create/create.types'
import type { Context, FilterAttributes, Query, Ref } from '@/document'
import type {
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	RawRecord,
	TrackedRecord,
	TransactionHooks,
} from '@/types'

/**
 * Get an existing child record or create it under the given parent.
 *
 * Lookup is always scoped to the direct children of `parentRef` (never document-wide),
 * in this order:
 * 1. Non-empty attributes → first sibling matching the attribute filter.
 * 2. No attributes, id present → first sibling with that id.
 * 3. No attributes, no id (singleton) → first existing sibling with that tag name.
 * 4. No match → creates.
 *
 * @example
 * // singleton
 * const a = await stageEnsureChild({ ..., params: { tagName: 'A', attributes: {} } })
 * // by attributes
 * const aa1 = await stageEnsureChild({ ..., params: { tagName: 'AA_1', attributes: { aAA_1: 'foo' } } })
 */
export async function stageEnsureChild<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	dialecteConfig: GenericConfig
	hooks?: TransactionHooks<GenericConfig>
	context: Context<GenericConfig>
	query: Query<GenericConfig>
	parentRef: Ref<GenericConfig, GenericElement>
	params: AddChildParams<GenericConfig, GenericElement, GenericChildElement>
}): Promise<
	TrackedRecord<GenericConfig, GenericChildElement> | RawRecord<GenericConfig, GenericChildElement>
> {
	const { dialecteConfig, hooks, context, query, parentRef, params: childParams } = params

	const filter = toFilterAttributes<GenericConfig, GenericChildElement>(childParams.attributes)

	const siblings = await getChildren({
		context,
		ref: parentRef,
		tagName: childParams.tagName,
	})

	const existing = filter
		? siblings.find((sibling) =>
				matchesAttributeFilter({ record: sibling, attributeFilter: filter }),
			)
		: childParams.id !== undefined
			? siblings.find((sibling) => sibling.id === childParams.id)
			: siblings[0]

	if (existing) return existing

	return stageAddChild({
		dialecteConfig,
		hooks,
		context,
		query,
		parentRef,
		params: childParams,
	})
}

/**
 * Converts AddChildParams attributes (value object or full-object array) to a FilterAttributes map.
 * Returns undefined when the result is empty, signalling a singleton lookup instead.
 */
function toFilterAttributes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	attributes: ChildAttributesOf<GenericConfig, GenericElement> | undefined,
): FilterAttributes<GenericConfig, GenericElement> | undefined {
	if (!attributes) return undefined

	const valueObject = Array.isArray(attributes)
		? Object.fromEntries(attributes.map((attribute) => [attribute.name, attribute.value]))
		: attributes

	const hasValues = Object.values(valueObject).some((value) => value !== undefined && value !== '')
	return hasValues ? (valueObject as FilterAttributes<GenericConfig, GenericElement>) : undefined
}
