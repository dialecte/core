import type { AnyDialecteConfig, ElementsOf, AttributesValueObjectOf } from '@/types'

export type UpdateParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	attributes?: Partial<AttributesValueObjectOf<GenericConfig, GenericElement>>
	value?: string
}
