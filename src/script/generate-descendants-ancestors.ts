#!/usr/bin/env node
/**
 * generate-descendants-ancestors.ts
 * Utility functions to compute DESCENDANTS and ANCESTORS by traversing graphs.
 * Used by generate-definition.ts to create descendants-ancestors.generated.ts
 */

/**
 * Compute all descendants of an element by traversing the CHILDREN graph.
 * Uses BFS to avoid infinite loops and handles cycles.
 */
export function computeDescendants(
	element: string,
	childrenMap: Record<string, string[]>,
): string[] {
	const descendants = new Set<string>()
	const queue: string[] = [element]
	const visited = new Set<string>([element])

	while (queue.length > 0) {
		const current = queue.shift()!
		const children = childrenMap[current] || []

		for (const child of children) {
			if (!visited.has(child)) {
				visited.add(child)
				descendants.add(child)
				queue.push(child)
			}
		}
	}

	return Array.from(descendants).sort()
}

/**
 * Compute all ancestors of an element by traversing the PARENTS graph.
 * Uses BFS to avoid infinite loops and handles cycles.
 */
export function computeAncestors(element: string, parentsMap: Record<string, string[]>): string[] {
	const ancestors = new Set<string>()
	const queue: string[] = [element]
	const visited = new Set<string>([element])

	while (queue.length > 0) {
		const current = queue.shift()!
		const parents = parentsMap[current] || []

		for (const parent of parents) {
			if (!visited.has(parent)) {
				visited.add(parent)
				ancestors.add(parent)
				queue.push(parent)
			}
		}
	}

	return Array.from(ancestors).sort()
}
