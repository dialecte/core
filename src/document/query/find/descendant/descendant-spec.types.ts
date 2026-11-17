import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/** The `omit` option, split into tags left out whatever their attributes and tags left out when a filter matches. */
export type OmitSpec = {
	/** The dialecte the `where` filters are read against (an `xsi:type` value names a type of it). */
	dialecteConfig: AnyDialecteConfig
	unconditional: Set<string>
	conditional: Array<{
		tagName: string
		where: Record<string, unknown>
	}>
}

/** One tag a flat collect gathers, with the attribute filter its records must match. */
export type FlatTarget = { tagName: string; where?: Record<string, unknown> }

/** One level of a path collect: its tag, its filter and the levels nested under it. */
export type PathNode = {
	tagName: string
	where?: Record<string, unknown>
	children: PathNode[]
	isLeaf: boolean
}

/** The `collect` option in the uniform shape the traversals read. */
export type CollectSpecification =
	| { mode: 'flat'; targets: FlatTarget[]; allTags: Set<string> }
	| { mode: 'path'; paths: PathNode[]; allTags: Set<string> }

/** The records collected under one scope: by tag name, by id. */
export type CollectedGroups<GenericConfig extends AnyDialecteConfig> = Map<
	string,
	Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>
>
