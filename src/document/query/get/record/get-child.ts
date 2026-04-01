import { getRecord } from './get-record'

import type { Context } from '@/document'
import type { AnyDialecteConfig, ChildrenOf, ElementsOf, TrackedRecord, RefOrRecord } from '@/types'

/**
 * Fetch the first direct child of a parent matching a given tag name.
 *
 * Returns `undefined` when the parent does not exist or has no matching child.
 */
export async function getChild<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: RefOrRecord<GenericConfig, GenericElement>
	tagName: GenericChildElement
}): Promise<TrackedRecord<GenericConfig, GenericChildElement> | undefined> {
	const { context, ref, tagName } = params

	const parent = await getRecord({ context, ref })
	if (!parent) return undefined

	const child = parent.children.find((c) => c.tagName === tagName)
	if (!child) return undefined

	return getRecord<GenericConfig, GenericChildElement>({ context, ref: child })
}
