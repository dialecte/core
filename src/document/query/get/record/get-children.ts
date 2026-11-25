import { getChildrenOfEach } from './get-children-of-each'

import { toRef } from '@/helpers'

import type { Context, RefOrRecord } from '@/document'
import type { AnyDialecteConfig, ChildrenOf, ElementsOf, TrackedRecord } from '@/types'

/**
 * Fetch all direct children of a parent matching a given tag name.
 *
 * When no direct match is found and the config declares `transparentElements`,
 * looks through those wrapper elements to find matching children one level deeper, a wrapper only in its own namespace.
 *
 * Returns an empty array when the parent does not exist or has no matching children.
 * The reads are `getChildrenOfEach`'s with one parent, given as a ref: a record given is read again
 * (inside a transaction, its staged version), as before the batch verb.
 *
 * @internal the context-level read behind `doc.query.getChildren`; callers use the query
 */
export async function getChildren<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: RefOrRecord<GenericConfig, GenericElement>
	tagName: GenericChildElement
}): Promise<TrackedRecord<GenericConfig, GenericChildElement>[]> {
	const { context, ref, tagName } = params
	const [children] = await getChildrenOfEach({ context, refsOrRecords: [toRef(ref)], tagName })
	return children ?? []
}
