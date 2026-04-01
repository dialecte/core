import { stageAddChild } from '../create/create'

import { findByAttributes, getRecord } from '@/document'

import type { AddChildParams } from '../create/create.types'
import type { Context, FilterAttributes } from '@/document'
import type {
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	RawRecord,
	TrackedRecord,
	Ref,
} from '@/types'

/**
 * Get an existing child record or create it under the given parent.
 *
 * Lookup strategy (in order):
 * 1. Non-empty attributes → findByAttributes, returns first match.
 * 2. No attributes → getRecord (by id if present, by tagName alone for singletons).
 * 3. No match → creates.
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
	context: Context<GenericConfig>
	parentRef: Ref<GenericConfig, GenericElement>
	params: AddChildParams<GenericConfig, GenericElement, GenericChildElement>
}): Promise<
	TrackedRecord<GenericConfig, GenericChildElement> | RawRecord<GenericConfig, GenericChildElement>
> {
	const { dialecteConfig, context, parentRef, params: childParams } = params

	const filter = toFilterAttributes<GenericConfig, GenericChildElement>(childParams.attributes)

	if (filter) {
		const [found] = await findByAttributes({
			context,
			tagName: childParams.tagName,
			attributes: filter,
		})
		if (found) return found
	} else {
		const ref = { tagName: childParams.tagName, id: childParams.id } as Ref<
			GenericConfig,
			GenericChildElement
		>
		const existing = await getRecord({ context, ref })
		if (existing) return existing
	}

	return stageAddChild({
		dialecteConfig,
		context,
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
	attributes: AddChildParams<
		GenericConfig,
		ElementsOf<GenericConfig>,
		GenericElement
	>['attributes'],
): FilterAttributes<GenericConfig, GenericElement> | undefined {
	const valueObject = Array.isArray(attributes)
		? Object.fromEntries(attributes.map((attribute) => [attribute.name, attribute.value]))
		: attributes

	const hasValues = Object.values(valueObject).some((value) => value !== undefined && value !== '')
	return hasValues ? (valueObject as FilterAttributes<GenericConfig, GenericElement>) : undefined
}
