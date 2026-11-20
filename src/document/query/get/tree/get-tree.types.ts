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
	 * collapsed branch from a leaf) but an empty `tree`. A bounded depth reads only the levels it needs (one
	 * batched store read per level), staged writes included.
	 */
	depth?: number
	/**
	 * The ids that expand, one level each, from the root: a node opens its children only when its id is listed and
	 * its parent opened (a listed id under a closed node is never reached), so an empty set answers the root alone.
	 * A node not opened keeps its `children` refs with an empty `tree`, as past `depth`. The elements `unwrap` hoists
	 * open when reached, their ids need no listing. With `depth` too, a node opens only when both allow it. Reads
	 * one batched store read per open level (a hoisted level is one more), never the whole document. One call
	 * rebuilds a lazy view's open frontier: an open state restored, a commit reported `unknown`, a target revealed
	 * with its ancestors listed.
	 */
	expanded?: ReadonlySet<string>
}
