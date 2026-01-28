import type { ChainRecord, AnyDialecteConfig, ElementsOf } from '@/types'

/**
 * Tree filter for getDescendants
 */
export type TreeFilter<GenericConfig extends AnyDialecteConfig> = {
	pick?: ElementsOf<GenericConfig>[]
	omit?: ElementsOf<GenericConfig>[]
	flatten?: boolean
}

/**
 * Descendants result - properly typed based on filter
 */
export type DescendantsResult<GenericConfig extends AnyDialecteConfig> = {
	[K in ElementsOf<GenericConfig>]?: ChainRecord<GenericConfig, K>[]
}

/**
 * Tree node structure
 */
export type TreeNode<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	element: ChainRecord<GenericConfig, GenericElement>
	children: TreeNode<GenericConfig, ElementsOf<GenericConfig>>[]
}
