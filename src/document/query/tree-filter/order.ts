import { orderByConfigSequence } from '@/utils'

import type { AnyDialecteConfig, AnyTreeRecord, ElementsOf, TreeRecord } from '@/types'

/**
 * Order every node's children by the config-declared child sequence
 * (pure `TreeRecord → TreeRecord`).
 *
 * Reuses the same `orderByConfigSequence` comparator as XML building, so a tree
 * and its XML serialization share one ordering. Apply as the final post-pass
 * (after `omit`/`unwrap`) so promoted children also sort into sequence.
 */
export function applyOrder<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tree: TreeRecord<GenericConfig, GenericElement>
	childrenConfig: GenericConfig['children']
}): TreeRecord<GenericConfig, GenericElement> {
	const { tree, childrenConfig } = params

	const orderNode = (node: AnyTreeRecord): AnyTreeRecord => {
		if (node.tree.length === 0) return node

		const children = orderByConfigSequence({
			parentTagName: node.tagName,
			children: node.tree.map(orderNode),
			childrenConfig,
		})
		return { ...node, tree: children }
	}

	return orderNode(tree as AnyTreeRecord) as TreeRecord<GenericConfig, GenericElement>
}
