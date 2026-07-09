import type {
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	Namespace,
	AttributesValueObjectOf,
	FullAttributeObjectOf,
} from '@/types'

export type ChildAttributesOf<
	GenericConfig extends AnyDialecteConfig,
	GenericChildElement extends ElementsOf<GenericConfig>,
> =
	| AttributesValueObjectOf<GenericConfig, GenericChildElement>
	| FullAttributeObjectOf<GenericConfig, GenericChildElement>[]

/**
 * `attributes` is optional when the child element has no required attributes
 * and required as soon as it declares at least one required attribute.
 */
type AddChildAttributesParams<
	GenericConfig extends AnyDialecteConfig,
	GenericChildElement extends ElementsOf<GenericConfig>,
> =
	{} extends AttributesValueObjectOf<GenericConfig, GenericChildElement>
		? { attributes?: ChildAttributesOf<GenericConfig, GenericChildElement> }
		: { attributes: ChildAttributesOf<GenericConfig, GenericChildElement> }

export type AddChildParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
> = {
	id?: `${string}-${string}-${string}-${string}-${string}`
	tagName: GenericChildElement
	namespace?: Namespace
	value?: string
} & AddChildAttributesParams<GenericConfig, GenericChildElement>
