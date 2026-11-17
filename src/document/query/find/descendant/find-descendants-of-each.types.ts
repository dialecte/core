import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/** A record the top-down walk kept: not omitted, under at least one scope. */
export type WalkNode<GenericConfig extends AnyDialecteConfig> = {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	/** The input positions that gave this record as their scope. */
	scopeOf: number[]
	/** The id of the kept record the walk reached it from; none for a scope no other scope's walk reached. */
	parentId?: string
}

/** The flat targets by tag name: the filters a record of that tag may match (`undefined` matches any). */
export type TargetsByTag = Map<string, (Record<string, unknown> | undefined)[]>

/** A scope the walk starts from: its input position and its record. */
export type WalkScope<GenericConfig extends AnyDialecteConfig> = {
	position: number
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
}

/** A tracked record of any tag of the dialecte. */
export type AnyTracked<GenericConfig extends AnyDialecteConfig> = TrackedRecord<
	GenericConfig,
	ElementsOf<GenericConfig>
>
