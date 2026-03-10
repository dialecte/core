import type { FilterAttributes } from '@/document'
import type { AnyDialecteConfig, ChildrenOf, ElementsOf } from '@/types'

export type GetTreeParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	include?: IncludeFilter<GenericConfig, GenericElement>
	exclude?: ExcludeFilter<GenericConfig>[]
	unwrap?: ElementsOf<GenericConfig>[]
}

// Recursive tree filter with type narrowing at each level.
// The filter for children is nested inside the filter for their parent —
// which child Server to include depends on which AccessPoint matched, etc.
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

// Flat exclude filter — same predicate regardless of ancestry path.
export type ExcludeFilter<GenericConfig extends AnyDialecteConfig> = {
	tagName: ElementsOf<GenericConfig>
	attributes?: FilterAttributes<GenericConfig, ElementsOf<GenericConfig>>
	scope?: 'self' | 'children' // 'self' = prune entire branch (default), 'children' = keep element but stop traversal
}
