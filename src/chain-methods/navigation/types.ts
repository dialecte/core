import type { AnyDialecteConfig, ElementsOf, SingletonElementsOf, AnyElement } from '@/types'

export type GoToElementParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> =
	GenericElement extends SingletonElementsOf<GenericConfig>
		? { tagName: GenericElement; id?: string }
		: { tagName: GenericElement; id: string }

export type AnyGoToElementParams = GoToElementParams<AnyDialecteConfig, AnyElement>
