import { declaredNamespaces } from '@/utils'

import type { UnwrapSet } from './unwrap.types'
import type { AnyDialecteConfig, ElementsOf, Namespace, TreeRecord } from '@/types'

/**
 * The unwrap set of a read: each tag given with the namespaces the dialecte's definition declares it in (its tag level
 * and each of its declarations); a tag the definition does not know is read in the dialecte's default namespace.
 *
 * @internal shared by the ancestor, tree and snapshot reads
 */
export function unwrapSetOf(params: {
	dialecteConfig: Pick<AnyDialecteConfig, 'definition' | 'namespaces'>
	tagNames: readonly string[]
}): UnwrapSet {
	const { dialecteConfig, tagNames } = params
	return new Map(
		tagNames.map((tagName) => [tagName, declaredNamespaceUris({ dialecteConfig, tagName })]),
	)
}

/**
 * Whether a read unwraps an element: its tag is in the set and it is in one of that tag's own namespaces.
 *
 * @internal shared by the ancestor, tree and snapshot reads
 */
export function isUnwrapped(params: {
	record: { tagName: string; namespace: Namespace }
	unwrapSet: UnwrapSet
}): boolean {
	const { record, unwrapSet } = params
	return unwrapSet.get(record.tagName)?.has(record.namespace.uri) ?? false
}

/**
 * Remove the layers the unwrap set names from a tree, promoting their children up to the
 * removed node's parent (pure `TreeRecord → TreeRecord`).
 *
 * Used to hide "transparent" structural elements that are abstracted away in the
 * UI, so both `getTree` and `getSnapshot` present the same shape. A same-name element in another
 * namespace stays a node.
 *
 * @internal `unwrap` post-pass of `getTree` and `getSnapshot`
 */
export function applyUnwrap<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tree: TreeRecord<GenericConfig, GenericElement>
	unwrapSet: UnwrapSet
}): TreeRecord<GenericConfig, GenericElement> {
	const { tree, unwrapSet } = params

	function processChildren(
		children: TreeRecord<GenericConfig, ElementsOf<GenericConfig>>[],
	): TreeRecord<GenericConfig, ElementsOf<GenericConfig>>[] {
		return children.flatMap((child) => {
			if (isUnwrapped({ record: child, unwrapSet })) {
				return processChildren(child.tree)
			}
			return [{ ...child, tree: processChildren(child.tree) }]
		})
	}

	return { ...tree, tree: processChildren(tree.tree) }
}

/** The namespace URIs a tag is the dialecte's element in: its declared ones, the default one for a tag not declared. */
function declaredNamespaceUris(params: {
	dialecteConfig: Pick<AnyDialecteConfig, 'definition' | 'namespaces'>
	tagName: string
}): ReadonlySet<string> {
	const { dialecteConfig, tagName } = params
	const declared = declaredNamespaces({ dialecteConfig, tagName })
	if (declared.length === 0) return new Set([dialecteConfig.namespaces.default.uri])
	return new Set(declared.map((namespace) => namespace.uri))
}
