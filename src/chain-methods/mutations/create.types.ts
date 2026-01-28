import type {
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	Namespace,
	AttributesValueObjectOf,
	FullAttributeObjectOf,
} from '@/types'

/**
 * AddChild with setFocus: true - narrows to child element type
 */
export type AddChildParamsWithFocus<
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
	setFocus: true
}

/**
 * AddChild with setFocus: false - stays on current element
 */
export type AddChildParamsWithoutFocus<
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
	setFocus?: false
}

/**
 * Union type for both addChild variants
 */
export type AddChildParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
> =
	| AddChildParamsWithFocus<GenericConfig, GenericElement, GenericChildElement>
	| AddChildParamsWithoutFocus<GenericConfig, GenericElement, GenericChildElement>

/**
 * Any addChild params - for tests or generic operations
 */
export type AnyAddChildParams = AddChildParams<AnyDialecteConfig, string, string>
