import type { OmitEntry } from '../../tree-filter'
import type { FilterAttributes } from '@/document'
import type { AnyDialecteConfig, ChildrenOf, ElementsOf } from '@/types'

// Reserved config keys - cannot collide with PascalCase element names.
type SelectConfigKeys = 'where' | 'recursive'

/**
 * Prisma-style tree projection. Keys = element names (PascalCase), values control traversal.
 * - `true` - include element and all its descendants
 * - `false` - exclude element (scoped to this level)
 * - `TreeSelect<...>` - nested projection with further narrowing
 *
 * Config options (camelCase):
 * - `where` - attribute filter for elements at this level
 * - `recursive` - re-apply this select block on self-referencing children (true = infinite, number = max depth, false = disable auto-recursion)
 */
export type TreeSelect<
	GenericConfig extends AnyDialecteConfig,
	GenericParent extends ElementsOf<GenericConfig>,
> = {
	[Child in ChildrenOf<GenericConfig, GenericParent> as Exclude<Child, SelectConfigKeys>]?:
		| true
		| false
		| TreeSelect<GenericConfig, Child & ElementsOf<GenericConfig>>
} & {
	where?: FilterAttributes<GenericConfig, GenericParent>
	recursive?: true | false | number
}

export type GetTreeParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	select?: TreeSelect<GenericConfig, GenericElement>
	omit?: OmitEntry<GenericConfig>[]
	unwrap?: ElementsOf<GenericConfig>[]
	/**
	 * Structural depth to expand. `undefined` = full tree; `0` = the node alone; `1` = node + its
	 * direct children; etc. Unexpanded nodes keep their `children` refs (so a caller can tell a
	 * collapsed branch from a leaf) but an empty `tree`. Bounded depth reads only the levels it
	 * needs (one batched store call per level) instead of the whole document — but only for a
	 * committed read (no pending staged writes) with a concrete `id`. Inside a transaction with
	 * pending writes, or without an `id`, a bounded `depth` still reads the whole document so the
	 * staged overlay stays correct; scoped BFS never runs against uncommitted state.
	 */
	depth?: number
}
