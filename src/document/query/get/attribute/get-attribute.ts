import { getRecord } from '@/document'

import type { Context } from '@/document'
import type {
	AnyDialecteConfig,
	AttributesOf,
	ElementsOf,
	FullAttributeObjectOf,
	Ref,
} from '@/types'

/**
 * Fetch a single attribute for the given ref.
 *
 * Resolves the record via context (staged → cache → store),
 * then extracts the named attribute.
 *
 * @example
 * getAttribute({ context, ref, name: 'name' })               // → string | ''
 */
export async function getAttribute<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	name: AttributesOf<GenericConfig, GenericElement>
}): Promise<GenericAttribute['value'] | ''> {
	const { context, ref, name } = params
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

	const attribute = attributes.find((attribute) => attribute.name === name)

	return attribute?.value ?? ''
}

/**
 * Fetch a single attribute for the given ref.
 *
 * Resolves the record via context (staged → cache → store),
 * then extracts the named attribute.
 *
 * @example
 * getAttribute({ context, ref, name: 'name', fullObject: true }) // → FullAttributeObject | undefined
 */
export async function getAttributeFullObject<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	name: AttributesOf<GenericConfig, GenericElement>
}): Promise<GenericAttribute | undefined> {
	const { context, ref, name } = params
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

	const attribute = attributes.find((attribute) => attribute.name === name)
	return attribute
}
