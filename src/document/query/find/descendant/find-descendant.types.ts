import type { FilterAttributes } from '@/document/query/find/by-attribute/find-by-attributes.types'
import type { OmitEntry } from '@/document/query/get/tree/get-tree.types'
import type { AnyDialecteConfig, DescendantsOf, ElementsOf, TrackedRecord } from '@/types'

// ============================================================================
// Collect Types
// ============================================================================

/**
 * Single collect entry with optional where filter.
 * { LNode: { where: { lnClass: 'LPHD' } } }
 */
export type CollectEntryWithFilter<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	[K in DescendantsOf<GenericConfig, GenericElement>]?: {
		where?: FilterAttributes<GenericConfig, K>
	}
}

/**
 * Path-aware collect using nested object shape (descendant-of semantic at each level).
 * { Function: { LNode: true } } means "LNode anywhere under Function anywhere under ref"
 */
export type CollectPath<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	[K in DescendantsOf<GenericConfig, GenericElement>]?:
		| true
		| { where?: FilterAttributes<GenericConfig, K> }
		| CollectPath<GenericConfig, K & ElementsOf<GenericConfig>>
}

/**
 * Array collect entry: either a plain tagName or an object with where filter.
 */
export type CollectArrayEntry<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> =
	| DescendantsOf<GenericConfig, GenericElement>
	| CollectEntryWithFilter<GenericConfig, GenericElement>

/**
 * The collect parameter discriminated union:
 * - string: single tagName
 * - array: multiple tagNames or objects with where
 * - object: path-aware collect
 */
export type Collect<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> =
	| DescendantsOf<GenericConfig, GenericElement>
	| CollectArrayEntry<GenericConfig, GenericElement>[]
	| CollectPath<GenericConfig, GenericElement>

// ============================================================================
// Params
// ============================================================================

export type FindDescendantsParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericCollect extends Collect<GenericConfig, GenericElement>,
> = {
	collect: GenericCollect
	omit?: OmitEntry<GenericConfig>[]
}

// ============================================================================
// Return Type Extraction
// ============================================================================

/**
 * Extract all tagNames from a collect spec for the return type.
 */
export type ExtractCollectTags<C> = C extends string
	? C
	: C extends Array<infer Item>
		? Item extends string
			? Item
			: Item extends Record<string, unknown>
				? keyof Item & string
				: never
		: C extends Record<string, unknown>
			? ExtractPathTags<C>
			: never

/**
 * Recursively extract all keys from a nested path object.
 */
type ExtractPathTags<T> =
	T extends Record<string, unknown>
		? {
				[K in keyof T & string]:
					| K
					| (T[K] extends Record<string, unknown> ? ExtractPathTags<T[K]> : never)
			}[keyof T & string]
		: never

// ============================================================================
// Result Types
// ============================================================================

export type FindDescendantsReturn<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericCollect extends Collect<GenericConfig, GenericElement>,
> = {
	[K in ExtractCollectTags<GenericCollect> & ElementsOf<GenericConfig>]: TrackedRecord<
		GenericConfig,
		K
	>[]
}
