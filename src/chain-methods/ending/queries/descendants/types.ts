import type { FilterAttributes } from '@/helpers'
import type {
	AnyDialecteConfig,
	DescendantsOf,
	ElementsOf,
	ChainRecord,
} from '@/types'

export type FindDescendantsReturn<
	GenericConfig extends AnyDialecteConfig,
	GenericFilter extends DescendantsFilter<GenericConfig> | undefined,
> = Promise<
		GenericFilter extends undefined
			? Partial<Record<ElementsOf<GenericConfig>, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]>>
			: GenericFilter extends DescendantsFilter<GenericConfig>
				? Partial<ResultMap<GenericConfig, ExtractTags<GenericFilter>>>
				: never
	>

// ============================================================================
// Core Types
// ============================================================================

export type PathLevel<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	tagName: GenericElement
	attributes?: FilterAttributes<GenericConfig, GenericElement>
}

// ============================================================================
// Filter Types - Recursive descendant matching
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
// Type Utilities
// ============================================================================

export type ExtractTags<F> = F extends { tagName: infer T }
	? T | (F extends { descendant?: infer D } ? ExtractTags<D> : never)
	: never

export type TagsArray<F> = ExtractTags<F> extends infer U ? ReadonlyArray<U> : never

// ============================================================================
// Result Types
// ============================================================================

export type ResultMap<GenericConfig extends AnyDialecteConfig, GenericTags extends string> = {
	[K in GenericTags]: ChainRecord<GenericConfig, K>[]
}

export type FindResult<
	GenericConfig extends AnyDialecteConfig,
	GenericFilter extends DescendantsFilter<GenericConfig>,
	GenericInclude extends ReadonlyArray<any> | ExtractTags<GenericFilter>,
> = ResultMap<
	GenericConfig,
	GenericInclude extends ReadonlyArray<any> ? GenericInclude[number] : GenericInclude
>

// ============================================================================
// Internal Types
// ============================================================================

export type CollectedTags<GenericConfig extends AnyDialecteConfig> = Map<
	string,
	ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]
>

export type ValidationResult<GenericConfig extends AnyDialecteConfig> = {
	valid: boolean
	ancestors?: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]
}
