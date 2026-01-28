import type { AnyDialecteConfig, ElementsOf, AttributesValueObjectOf } from '@/types'

export type UpdateElementParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	attributes?: AttributesValueObjectOf<GenericConfig, GenericElement>
	value?: string
}
