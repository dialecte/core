import type { AnyDialecteConfig, ChainRecord, ElementsOf, TreeRecord } from '@/types'

/**
 * Flatten tree to flat list of all descendant records (excluding root)
 */
export function flattenTree<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	tree: TreeRecord<GenericConfig, GenericElement>,
): ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[] {
	const records: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[] = []

	function traverse(node: TreeRecord<GenericConfig, ElementsOf<GenericConfig>>) {
		if (!node.tree?.length) return

		for (const child of node.tree) {
			records.push(child)
			traverse(child)
		}
	}

	traverse(tree)
	return records
}
