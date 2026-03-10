import type { AnyDialecteConfig, AttributesOf, AttributesValueObjectOf, ElementsOf } from '@/types'

export type FilterAttributes<
	GenericVersion extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericVersion>,
> = {
	[K in AttributesOf<GenericVersion, GenericElement>]?:
		| AttributesValueObjectOf<GenericVersion, GenericElement>[K]
		| Array<AttributesValueObjectOf<GenericVersion, GenericElement>[K]>
}
