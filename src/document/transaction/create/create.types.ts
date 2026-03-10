import type {
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	Namespace,
	AttributesValueObjectOf,
	FullAttributeObjectOf,
} from '@/types'

export type AddChildParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
> = {
	id?: `${string}-${string}-${string}-${string}-${string}`
	tagName: GenericChildElement
	namespace?: Namespace
	attributes:
		| AttributesValueObjectOf<GenericConfig, GenericChildElement>
		| FullAttributeObjectOf<GenericConfig, GenericChildElement>[]
	value?: string
}
