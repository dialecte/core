import type { OmitSpecification } from '../../tree-filter'
import type { TreeSelect } from './get-tree.types'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/** What decides which children of a node a tree keeps: the same for every node of one `getTree` call. */
export type TreeShaping<GenericConfig extends AnyDialecteConfig> = {
	compiledOmit: OmitSpecification<GenericConfig>
	/** The dialecte auto-recursion reads its self-recursive elements from; none, no auto-recursion. */
	dialecteConfig?: GenericConfig
	transparentElements?: readonly string[]
}

/** A child a tree keeps, with the `select` that shapes its own children (`undefined`: all of them). */
export type KeptChild<GenericConfig extends AnyDialecteConfig> = {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
}

/** A node of the frontier: a record kept, the `select` of its children and the levels left below it. */
export type FrontierNode<GenericConfig extends AnyDialecteConfig> = {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	remainingDepth: number
}
