import type { AnyDialecteConfig, ElementsOf } from '@/types'

export type FindAncestorsOptions<GenericConfig extends AnyDialecteConfig> = {
	depth?: number
	stopAtTagName?: ElementsOf<GenericConfig>
	order?: 'bottom-up' | 'top-down'
	/**
	 * Elements left out of the chain, the walk going on through them: they take no `depth` level and `stopAtTagName`
	 * never matches them. Default: the dialecte's `transparentElements`; `[]` answers every stored ancestor.
	 */
	unwrap?: ElementsOf<GenericConfig>[]
}
