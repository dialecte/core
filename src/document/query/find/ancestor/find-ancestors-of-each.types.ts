import type { AnyDialecteConfig, ElementsOf } from '@/types'

/** A parent link followed by the ancestor walk: a tag name and the id it is read by. */
export type ParentLink<GenericConfig extends AnyDialecteConfig> = {
	readonly tagName: ElementsOf<GenericConfig>
	readonly id: string
}

/** Where an input position's walk starts: its element's parent link (`null` at the root). */
export type WalkStart<GenericConfig extends AnyDialecteConfig> = {
	parent: ParentLink<GenericConfig> | null
}
