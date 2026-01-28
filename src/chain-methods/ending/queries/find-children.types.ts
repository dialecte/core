import type { FilterAttributes } from '@/helpers'
import type { AnyDialecteConfig, ElementsOf, ChildrenOf } from '@/types'

export type FindChildrenParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChild extends ChildrenOf<GenericConfig, GenericElement>,
> = Partial<{
	[K in GenericChild]: FilterAttributes<GenericConfig, K>
}>
