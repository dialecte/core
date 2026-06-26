import type { AnyDialecteConfig, ElementsOf, TreeRecord } from '@/types'

/**
 * Remove `unwrapTagNames` layers from a tree, promoting their children up to the
 * removed node's parent (pure `TreeRecord → TreeRecord`).
 *
 * Used to hide "transparent" structural elements that are abstracted away in the
 * UI, so both `getTree` and `getSnapshot` present the same shape.
 */
export function applyUnwrap<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tree: TreeRecord<GenericConfig, GenericElement>
	unwrapTagNames: ElementsOf<GenericConfig>[]
}): TreeRecord<GenericConfig, GenericElement> {
	const { tree, unwrapTagNames } = params

	function processChildren(
		children: TreeRecord<GenericConfig, ElementsOf<GenericConfig>>[],
	): TreeRecord<GenericConfig, ElementsOf<GenericConfig>>[] {
		return children.flatMap((child) => {
			if (unwrapTagNames.includes(child.tagName)) {
				return processChildren(child.tree)
			}
			return [{ ...child, tree: processChildren(child.tree) }]
		})
	}

	return { ...tree, tree: processChildren(tree.tree) }
}
