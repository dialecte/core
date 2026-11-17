import type { RecordLink } from './known-records.types'

/** What a parent is answered from: its children, as its record names them. */
export type ParentChildren = {
	readonly children: ReadonlyArray<RecordLink>
}

/** A parent's direct children of the tag, or, when it has none, its transparent wrappers to look into. */
export type ChildLookup = {
	readonly direct: RecordLink[]
	readonly wrappers: RecordLink[]
}
