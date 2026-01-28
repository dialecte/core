import type { FilterAttributes } from '@/helpers'
import type { AnyDialecteConfig, ElementsOf, ChildrenOf } from '@/types'

export type GetTreeParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	include?: IncludeFilter<GenericConfig, GenericElement>
	exclude?: ExcludeFilter<GenericConfig>[]
	unwrap?: ElementsOf<GenericConfig>[]
}

// Recursive tree filter with type narrowing at each level
export type IncludeFilter<
	GenericConfig extends AnyDialecteConfig,
	GenericParent extends ElementsOf<GenericConfig>,
> =
	ChildrenOf<GenericConfig, GenericParent> extends infer Child
		? Child extends ElementsOf<GenericConfig>
			? {
					tagName: Child
					attributes?: FilterAttributes<GenericConfig, Child>
					children?: IncludeFilter<GenericConfig, Child>[]
				}
			: never
		: never

// Simple exclude filter (flat, no recursion)
export type ExcludeFilter<GenericConfig extends AnyDialecteConfig> = {
	tagName: ElementsOf<GenericConfig>
	attributes?: FilterAttributes<GenericConfig, ElementsOf<GenericConfig>>
	scope?: 'self' | 'children' // 'self' = remove entire branch (default), 'children' = keep element but exclude its children
}
