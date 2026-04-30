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
 * - `recursive` - re-apply this select block on self-referencing children (true = infinite, number = max depth)
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
	recursive?: true | number
}

/**
 * Omit entry: plain tagName string (exclude all) or object with attribute filter.
 */
export type OmitEntry<GenericConfig extends AnyDialecteConfig> =
	| ElementsOf<GenericConfig>
	| {
			tagName: ElementsOf<GenericConfig>
			where?: FilterAttributes<GenericConfig, ElementsOf<GenericConfig>>
			scope?: 'self' | 'children'
	  }

export type GetTreeParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	select?: TreeSelect<GenericConfig, GenericElement>
	omit?: OmitEntry<GenericConfig>[]
	unwrap?: ElementsOf<GenericConfig>[]
}
