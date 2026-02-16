import type { FilterAttributes } from '@/helpers'
import type { AnyDialecteConfig, DescendantsOf, ElementsOf, ChainRecord } from '@/types'

// ============================================================================
// Filter Types - Recursive descendant matching (any depth)
// ============================================================================

type Depth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

type FilterNode<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	D extends number,
> = Depth[D] extends never
	? never
	: {
			[K in DescendantsOf<GenericConfig, GenericElement>]: {
				tagName: K
				attributes?: FilterAttributes<GenericConfig, K>
				descendant?: FilterNode<GenericConfig, K, Depth[D]>
			}
		}[DescendantsOf<GenericConfig, GenericElement>]

export type DescendantsFilter<GenericConfig extends AnyDialecteConfig> = {
	[K in ElementsOf<GenericConfig>]: {
		tagName: K
		attributes?: FilterAttributes<GenericConfig, K>
		descendant?: FilterNode<GenericConfig, K, 10>
	}
}[ElementsOf<GenericConfig>]

// ============================================================================
// Internal Types
// ============================================================================

export type FilterCondition<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	tagName: GenericElement
	attributes?: FilterAttributes<GenericConfig, GenericElement>
	optional?: boolean // True if no attributes specified (collect if exists, don't require)
}

// ============================================================================
// Type Utilities
// ============================================================================

export type ExtractTags<F> = F extends { tagName: infer T }
	? T | (F extends { descendant?: infer D } ? ExtractTags<D> : never)
	: never

// ============================================================================
// Result Types
// ============================================================================

export type ResultMap<GenericConfig extends AnyDialecteConfig, GenericTags extends string> = {
	[K in GenericTags]: ChainRecord<GenericConfig, K>[]
}

export type FindDescendantsReturn<
	GenericConfig extends AnyDialecteConfig,
	GenericFilter extends DescendantsFilter<GenericConfig> | undefined,
	GenericElement extends ElementsOf<GenericConfig> = ElementsOf<GenericConfig>,
> = Promise<
	GenericFilter extends undefined
		? {
				[K in GenericElement | DescendantsOf<GenericConfig, GenericElement>]: ChainRecord<
					GenericConfig,
					K
				>[]
			}
		: GenericFilter extends DescendantsFilter<GenericConfig>
			? ResultMap<GenericConfig, ExtractTags<GenericFilter>>
			: never
>
