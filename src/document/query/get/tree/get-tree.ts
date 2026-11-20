import { applyUnwrap, applyOrder, parseOmit } from '../../tree-filter'
import { loadTreeRecords } from './load-tree-records'
import { childRefsToRead, childReach, expandsChildren, keptChildren } from './tree-children'

import { toTreeRecord } from '@/helpers'
import { invariant } from '@/utils'

import type { KnownRecords } from '../record/known-records.types'
import type { GetTreeParams, TreeSelect } from './get-tree.types'
import type { TreeReach, TreeShaping } from './tree-children.types'
import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord, TreeRecord } from '@/types'

//== Main export

/**
 * The subtree under a ref as a `TreeRecord`, staged writes overlaid, shaped by `select`, `omit`, `unwrap`, `depth`
 * and `expanded`; the context-level read behind `doc.query.getTree`.
 *
 * Reads only the branches it can keep, one `getRecords` per level: a ref with an id below the document root reads
 * its own subtree, and a `select`, an unconditional `omit`, a `depth` or `expanded` prunes further. The document
 * root, or a ref without id, with nothing to prune reads the whole document once (see `loadTreeRecords`). The
 * elements `unwrap` hoists take no `depth` level and open when reached (see `childReach`).
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
	const { omit, unwrap, depth, expanded } = options
	const select = options.select as TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined

	const transparentElements = context.dialecteConfig.transparentElements as
		| readonly string[]
		| undefined
	// Auto-unwrap transparent elements when unwrap is not explicitly provided
	const unwrapTagNames = unwrap ?? (transparentElements?.length ? transparentElements : undefined)
	const shaping: TreeShaping<GenericConfig> = {
		compiledOmit: parseOmit({ omit, dialecteConfig: context.dialecteConfig }),
		dialecteConfig,
		transparentElements,
		unwrapTagNames: new Set(unwrapTagNames),
		expanded,
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
		reach: { remainingDepth: depth ?? Number.POSITIVE_INFINITY, hoisted: false },
	})

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
	reach: TreeReach
}): TreeRecord<GenericConfig, ElementsOf<GenericConfig>> {
	const { recordsById, record, select, shaping, reach } = params

	// Stop at the lazy boundary (keep the node, drop its subtree) or an omit scope=children match.
	if (!expandsChildren<GenericConfig>({ record, reach, shaping })) {
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
				reach: childReach<GenericConfig>({ tagName: kept.record.tagName, reach, shaping }),
			}),
	)

	return toTreeRecord({ record, tree: childTrees })
}
