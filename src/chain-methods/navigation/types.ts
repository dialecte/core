import type {
	AnyDialecteConfig,
	ElementsOf,
	SingletonElementsOf,
	AnyElement,
	ParentsOf,
	AnyParent,
} from '@/types'

export type GoToElementParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> =
	GenericElement extends SingletonElementsOf<GenericConfig>
		? { tagName: GenericElement; id?: string }
		: { tagName: GenericElement; id: string }

export type AnyGoToElementParams = GoToElementParams<AnyDialecteConfig, AnyElement>

export type GoToParentParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericParentElement extends ParentsOf<GenericConfig, GenericElement>,
> = GenericParentElement

export type AnyGoToParentParams = GoToParentParams<AnyDialecteConfig, AnyElement, AnyParent>
