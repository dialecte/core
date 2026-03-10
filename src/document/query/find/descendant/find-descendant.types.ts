import type { FilterAttributes } from '@/document/query/find/by-attribute/find-by-attributes.types'
import type { AnyDialecteConfig, DescendantsOf, ElementsOf, TrackedRecord } from '@/types'

// ============================================================================
// Filter Types - Recursive descendant matching (any depth)
// ============================================================================

type Depth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] // Support up to 20 levels of nesting

type FilterNode<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	D extends number,
> = Depth[D] extends never
	? never
	: {
			[K in DescendantsOf<GenericConfig, GenericElement>]: {
				tagName: K
				/** Match only if this element has these attributes. */
				attributes?: FilterAttributes<GenericConfig, K>
				/**
				 * When true, collect this element if present but do not require it on the path.
				 * Default: false (required — candidates whose path lacks this element are excluded).
				 */
				isOptional?: boolean
				descendant?: FilterNode<GenericConfig, K, Depth[D]>
			}
		}[DescendantsOf<GenericConfig, GenericElement>]

export type DescendantsFilter<GenericConfig extends AnyDialecteConfig> = {
	[K in ElementsOf<GenericConfig>]: {
		tagName: K
		/** Match only if this element has these attributes. */
		attributes?: FilterAttributes<GenericConfig, K>
		/**
		 * When true, collect this element if present but do not require it on the path.
		 * Default: false (required — candidates whose path lacks this element are excluded).
		 */
		isOptional?: boolean
		descendant?: FilterNode<GenericConfig, K, 20>
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
	optional: boolean
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
	[K in GenericTags]: TrackedRecord<GenericConfig, K>[]
}

export type FindDescendantsReturn<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericFilter extends DescendantsFilter<GenericConfig> | undefined,
> = GenericFilter extends undefined
	? {
			[K in GenericElement | DescendantsOf<GenericConfig, GenericElement>]: TrackedRecord<
				GenericConfig,
				K
			>[]
		}
	: GenericFilter extends DescendantsFilter<GenericConfig>
		? ResultMap<GenericConfig, ExtractTags<GenericFilter>>
		: never
