import { applyUnwrap, applyOrder, parseOmit } from '../../tree-filter'
import { loadTreeRecords } from './load-tree-records'
import { childRefsToRead, expandsChildren, keptChildren } from './tree-children'

import { toTreeRecord } from '@/helpers'
import { invariant } from '@/utils'

import type { KnownRecords } from '../record/known-records.types'
import type { GetTreeParams, TreeSelect } from './get-tree.types'
import type { TreeShaping } from './tree-children.types'
import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord, TreeRecord } from '@/types'

//== Main export

/**
 * The subtree under a ref as a `TreeRecord`, staged writes overlaid, shaped by `select`, `omit`, `unwrap` and
 * `depth`; the context-level read behind `doc.query.getTree`.
 *
 * Reads only the branches it can keep, one `getRecords` per level: a ref with an id below the document root reads
 * its own subtree, and a `select`, an unconditional `omit` or a `depth` prunes further. The document root, or a ref
 * without id, with nothing to prune reads the whole document once (see `loadTreeRecords`).
 *
 * @internal the context-level read behind `doc.query.getTree`; callers use the query
 */
export async function getTree<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	options?: GetTreeParams<GenericConfig, GenericElement>
	dialecteConfig?: GenericConfig
}): Promise<TreeRecord<GenericConfig, GenericElement> | undefined> {
	const { context, ref, options = {}, dialecteConfig } = params
	const { omit, unwrap, depth } = options
	const select = options.select as TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined

	const transparentElements = context.dialecteConfig.transparentElements as
		| readonly string[]
		| undefined
	const shaping: TreeShaping<GenericConfig> = {
		compiledOmit: parseOmit({ omit, dialecteConfig: context.dialecteConfig }),
		dialecteConfig,
		transparentElements,
	}

	const { root, recordsById } = await loadTreeRecords<GenericConfig, GenericElement>({
		context,
		ref,
		select,
		depth,
		shaping,
	})
	invariant(root, {
		detail: 'No record found for provided ref',
		key: 'ELEMENT_NOT_FOUND',
	})

	const tree = buildNode<GenericConfig>({
		recordsById,
		record: root as TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>,
		select,
		shaping,
		remainingDepth: depth ?? Number.POSITIVE_INFINITY,
	})

	// Auto-unwrap transparent elements when unwrap is not explicitly provided
	const unwrapTagNames = unwrap ?? (transparentElements?.length ? transparentElements : undefined)

	const unwrapped = unwrapTagNames
		? applyUnwrap({ tree, unwrapTagNames: unwrapTagNames as ElementsOf<GenericConfig>[] })
		: tree

	// Final post-pass: order children by the config sequence (matches XML order).
	return applyOrder({
		tree: unwrapped,
		childrenConfig: context.dialecteConfig.children,
		definition: context.dialecteConfig.definition,
	}) as TreeRecord<GenericConfig, GenericElement>
}

//== Node builder

/** The tree under a record, from the records read: the children kept, each shaped by its own `select`. */
function buildNode<GenericConfig extends AnyDialecteConfig>(params: {
	recordsById: KnownRecords<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	shaping: TreeShaping<GenericConfig>
	remainingDepth: number
}): TreeRecord<GenericConfig, ElementsOf<GenericConfig>> {
	const { recordsById, record, select, shaping, remainingDepth } = params

	// Stop at the depth boundary (keep the node, drop its subtree) or an omit scope=children match.
	if (
		!expandsChildren<GenericConfig>({ record, remainingDepth, compiledOmit: shaping.compiledOmit })
	) {
		return toTreeRecord({ record })
	}

	const children = childRefsToRead<GenericConfig>({ record, select, shaping }).flatMap(
		(childRef) => {
			const child = recordsById.get(childRef.id)
			return child ? [child] : []
		},
	)
	const childTrees = keptChildren<GenericConfig>({ record, children, select, shaping }).map(
		(kept) =>
			buildNode<GenericConfig>({
				recordsById,
				record: kept.record,
				select: kept.select,
				shaping,
				remainingDepth: remainingDepth - 1,
			}),
	)

	return toTreeRecord({ record, tree: childTrees })
}
