import { findAncestorsOfEach } from './find-ancestors-of-each'

import type { FindAncestorsOptions } from './find-ancestor.types'
import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'
/**
 * Walk the parent chain from a record upward.
 *
 * Returns ancestors bottom-up: [parent, grandparent, …, root] by default.
 * Pass `order: 'top-down'` to get [root, …, grandparent, parent] instead.
 * The starting record is NOT included; it is read from its ref (staged operations first), so a staged move answers
 * its new parents.
 * When `stopAtTagName` is set, the walk stops after collecting that element (inclusive).
 * When `depth` is set, at most that many ancestors are returned.
 *
 * Perf: the walk of `findAncestorsOfEach` for one element: one `core::store::getMany` per level read from the store.
 *
 * @internal the context-level read behind `doc.query.findAncestors`; callers use the query
 */
export async function findAncestors<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	options?: FindAncestorsOptions<GenericConfig>
}): Promise<TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { context, ref, options } = params
	const [ancestors] = await findAncestorsOfEach({ context, refsOrRecords: [ref], options })
	return ancestors
}
