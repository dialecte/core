import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/** A parent link followed by the ancestor walk: a tag name and the id it is read by. */
export type ParentLink<GenericConfig extends AnyDialecteConfig> = {
	readonly tagName: ElementsOf<GenericConfig>
	readonly id: string
}

/** Where an input position's walk starts: its element's parent link (`null` at the root). */
export type WalkStart<GenericConfig extends AnyDialecteConfig> = {
	parent: ParentLink<GenericConfig> | null
}

/** The records read during one call, by id: each is read once however many chains pass through it. */
export type KnownRecords<GenericConfig extends AnyDialecteConfig> = Map<
	string,
	TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
>
