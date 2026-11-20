import type { AnyTreeRecord } from '@/types'

/**
 * A full tree cut at a lazy boundary: a node keeps its `tree` while its visible level (the root at 0, after unwrap)
 * is below `depth` and its id is in `expanded`, when given; past the boundary its `tree` is empty, its refs kept.
 */
export function cutTree(params: {
	tree: AnyTreeRecord
	depth?: number
	expanded?: ReadonlySet<string>
	level?: number
}): AnyTreeRecord {
	const { tree, depth = Number.POSITIVE_INFINITY, expanded, level = 0 } = params
	const opens = level < depth && (expanded?.has(tree.id) ?? true)
	if (!opens) return { ...tree, tree: [] }
	return {
		...tree,
		tree: tree.tree.map((child) =>
			cutTree({ tree: child as AnyTreeRecord, depth, expanded, level: level + 1 }),
		),
	}
}

/** The ids of a tree, the root first. */
export function idsOf(tree: AnyTreeRecord): string[] {
	return [tree.id, ...tree.tree.flatMap((child) => idsOf(child as AnyTreeRecord))]
}
