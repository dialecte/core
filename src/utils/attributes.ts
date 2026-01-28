import type { AnyDialecteConfig, ElementsOf, FullAttributeObjectOf } from '@/types'

export function getAttributeValueByName<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	attributes: GenericAttribute[]
	name: GenericAttribute['name']
}): GenericAttribute['value'] | '' {
	const { attributes, name } = params
	const attribute = attributes.find((attribute) => attribute.name === name)
	const value = attribute?.value || ''

	return value
}

export function getAttributesValuesByName<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	attributes: GenericAttribute[]
}): Record<GenericAttribute['name'], GenericAttribute['value']> {
	const { attributes } = params

	return attributes.reduce(
		(acc, attribute) => {
			const value = attribute.value || ''

			acc[attribute.name] = value
			return acc
		},
		{} as Record<GenericAttribute['name'], GenericAttribute['value']>,
	)
}
