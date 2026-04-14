import type { AnyDialecteConfig, ElementsOf } from '@/types'

export type FindAncestorsOptions<GenericConfig extends AnyDialecteConfig> = {
	depth?: number
	stopAtTagName?: ElementsOf<GenericConfig>
	order?: 'bottom-up' | 'top-down'
}
