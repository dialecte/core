import type { FilterAttributes } from '@/document'
import type { AnyDialecteConfig, ElementsOf } from '@/types'

/**
 * Omit entry with optional where filter and scope.
 * Key-based format consistent with collect entries:
 * - `'DOS'` - omit all DOS elements
 * - `{ LNode: { where: { lnClass: 'LPHD' } } }` - conditional omit
 * - `{ AA_1: { scope: 'children' } }` - keep node, stop traversal
 */
export type OmitEntryWithFilter<GenericConfig extends AnyDialecteConfig> = {
	[K in ElementsOf<GenericConfig>]?: {
		where?: FilterAttributes<GenericConfig, K>
		scope?: 'self' | 'children'
	}
}

export type OmitEntry<GenericConfig extends AnyDialecteConfig> =
	| ElementsOf<GenericConfig>
	| OmitEntryWithFilter<GenericConfig>
