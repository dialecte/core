import { getRecord } from '@/document'

import type { Context } from '@/document'
import type {
	AnyDialecteConfig,
	AttributesValueObjectOf,
	ElementsOf,
	FullAttributeObjectOf,
	Ref,
} from '@/types'

/**
 * Fetch all attributes for the given ref.
 *
 * Resolves the record via context (staged → cache → store),
 * then returns attributes as a value object (destructurable).
 *
 * @example
 * getAttributes({ context, ref })                      // → { name: '', desc: '', ... }
 */

export async function getAttributes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
}): Promise<AttributesValueObjectOf<GenericConfig, GenericElement>> {
	const { context, ref } = params
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

	return attributes.reduce(
		(acc, attr) => {
			acc[attr.name] = attr.value ?? ''
			return acc
		},
		{} as AttributesValueObjectOf<GenericConfig, GenericElement>,
	)
}

/**
 * Fetch all attributes for the given ref.
 *
 * Resolves the record via context (staged → cache → store),
 * then returns attributes as a full array.
 *
 * @example
 * getAttributes({ context, ref, fullObject: true })    // → FullAttributeObject[]
 */

export async function getAttributesFullObject<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
}): Promise<GenericAttribute[]> {
	const { context, ref } = params
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

	return attributes
}
