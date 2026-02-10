import type { AnyDialecteConfig, ElementsOf, AnyElement, ParentsOf, AnyParent } from '@/types'

export type DeleteElementParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericParentElement extends ParentsOf<GenericConfig, GenericElement>,
> = { parentTagName: GenericParentElement }

export type AnyDeleteParams = DeleteElementParams<AnyDialecteConfig, AnyElement, AnyParent>
