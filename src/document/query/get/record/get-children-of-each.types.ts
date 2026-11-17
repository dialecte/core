import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/** A child as its parent's record names it: a tag name and the id it is read by. */
export type ChildLink = {
	readonly tagName: string
	readonly id: string
}

/** What a parent is answered from: its children, as its record names them. */
export type ParentChildren = {
	readonly children: ReadonlyArray<ChildLink>
}

/** A parent's direct children of the tag, or, when it has none, its transparent wrappers to look into. */
export type ChildLookup = {
	readonly direct: ChildLink[]
	readonly wrappers: ChildLink[]
}

/** The records read during one call, by id: each is read once however many parents name it. */
export type KnownRecords<GenericConfig extends AnyDialecteConfig> = Map<
	string,
	TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
>
