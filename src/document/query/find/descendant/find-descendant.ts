import { findDescendantsOfEach } from './find-descendants-of-each'

import type { Collect, FindDescendantsParams, FindDescendantsReturn } from './find-descendant.types'
import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf } from '@/types'

/**
 * Collect the descendants of `ref` by tag name: `findDescendantsOfEach` for one element.
 *
 * Reads: the element by its ref, then, for a flat collect under an element that is not the document root, one
 * store read per level of its subtree, only the branches that can hold a collected tag. Under the document root a
 * flat collect reads each tag once; a path collect reads level by level and switches to one whole-document read
 * once that is cheaper.
 *
 * Order: the groups are keyed by tag name. Under an element that is not the document root, a flat collect answers
 * each group in id order; otherwise in no guaranteed order (the store's own; it is not guaranteed to be document
 * order).
 *
 * @internal the context-level read behind `doc.query.findDescendants`; callers use the query
 */
export async function findDescendants<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericCollect extends Collect<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	options: FindDescendantsParams<GenericConfig, GenericElement, GenericCollect>
}): Promise<FindDescendantsReturn<GenericConfig, GenericElement, GenericCollect>> {
	const { context, ref, options } = params
	const [answer] = await findDescendantsOfEach<GenericConfig, GenericElement, GenericCollect>({
		context,
		refsOrRecords: [ref],
		options,
	})
	return answer
}
