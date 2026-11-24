import type { OmitSpecification, UnwrapSet } from '../../tree-filter'
import type { TreeSelect } from './get-tree.types'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/** What decides which children of a node a tree keeps: the same for every node of one `getTree` call. */
export type TreeShaping<GenericConfig extends AnyDialecteConfig> = {
	compiledOmit: OmitSpecification<GenericConfig>
	/** The dialecte auto-recursion reads its self-recursive elements from; none, no auto-recursion. */
	dialecteConfig?: GenericConfig
	/** The dialecte's transparent elements: a `select` is passed through them to their children. */
	transparent: UnwrapSet
	/** The elements the call hoists (`unwrap`, else the transparent elements): a node of these takes no depth level. */
	unwrapSet: UnwrapSet
	/** The ids that open (`expanded`); none, every node opens within `depth`. */
	expanded?: ReadonlySet<string>
}

/** Where a node sits against the lazy boundary: the visible levels left below it, and whether the call hoists it. */
export type TreeReach = {
	remainingDepth: number
	/** A child whose tag the call hoists: it takes no depth level and opens when reached, listed or not. */
	hoisted: boolean
}

/** A child a tree keeps, with the `select` that shapes its own children (`undefined`: all of them). */
export type KeptChild<GenericConfig extends AnyDialecteConfig> = {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
}

/** A node of the frontier: a record kept, the `select` of its children and its reach. */
export type FrontierNode<GenericConfig extends AnyDialecteConfig> = {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	reach: TreeReach
}
