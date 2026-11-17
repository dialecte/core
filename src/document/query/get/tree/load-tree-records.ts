import { getRecord } from '../record/get-record'
import { loadLiveRecords } from '../record/load-live-records'
import { readUnknownRecords } from '../record/read-unknown-records'
import { childRefsToRead, expandsChildren, keptChildren } from './tree-children'

import { toDialecteError } from '@/errors'

import type { KnownRecords } from '../record/known-records.types'
import type { TreeSelect } from './get-tree.types'
import type { FrontierNode, TreeShaping } from './tree-children.types'
import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/**
 * The records a `getTree` call assembles its tree from, staged operations overlaid, with the root it asked for
 * (`undefined` when the ref names no element of its tag).
 *
 * When a `select`, an unconditional `omit` or a `depth` can prune, reads the root by its ref (a ref without id by
 * its tag name), then the kept children level by level, one `getRecords` per level over the whole frontier: a child
 * ref is read only when its tag can be kept, and the conditional parts (`where`, an `omit` with `where`) are checked
 * once it is read, before its own children are. A child dropped is never followed. When nothing can prune, one
 * whole-document read serves the tree.
 *
 * @internal the record source of `getTree`
 */
export async function loadTreeRecords<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	depth: number | undefined
	shaping: TreeShaping<GenericConfig>
}): Promise<{
	root: TrackedRecord<GenericConfig, GenericElement> | undefined
	recordsById: KnownRecords<GenericConfig>
}> {
	const { context, ref, select, depth, shaping } = params
	const prunes =
		select !== undefined || depth !== undefined || shaping.compiledOmit.unconditional.size > 0
	if (!prunes) {
		const recordsById = await loadLiveRecords<GenericConfig>(context)
		return { root: rootIn({ recordsById, ref }), recordsById }
	}

	const root = await readRoot({ context, ref })
	if (!root) return { root: undefined, recordsById: new Map() }

	const rootNode: FrontierNode<GenericConfig> = {
		record: root as TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>,
		select,
		remainingDepth: depth ?? Number.POSITIVE_INFINITY,
	}
	const levels = await readLevels<GenericConfig>({ context, frontier: [rootNode], shaping })
	const recordsById: KnownRecords<GenericConfig> = new Map([
		[root.id, rootNode.record],
		...levels.flatMap((level) => [...level]),
	])
	return { root, recordsById }
}

/** The root by its ref: by id, or by tag name for a singleton; a record of another tag than the ref is not it. */
async function readRoot<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
}): Promise<TrackedRecord<GenericConfig, GenericElement> | undefined> {
	try {
		return await getRecord<GenericConfig, GenericElement>(params)
	} catch (error) {
		if (toDialecteError(error)?.key === 'ELEMENT_TAGNAME_MISMATCH') return undefined
		throw error
	}
}

/**
 * The records of each level the frontier keeps, one `getRecords` per level, until no node expands. A record has one
 * parent, so no level reads an id an earlier level read: each level's records are answered apart and merged once.
 */
async function readLevels<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	frontier: FrontierNode<GenericConfig>[]
	shaping: TreeShaping<GenericConfig>
}): Promise<KnownRecords<GenericConfig>[]> {
	const { context, frontier, shaping } = params
	const expanding = frontier
		.filter((node) =>
			expandsChildren<GenericConfig>({
				record: node.record,
				remainingDepth: node.remainingDepth,
				compiledOmit: shaping.compiledOmit,
			}),
		)
		.map((node) => ({
			node,
			links: childRefsToRead<GenericConfig>({ record: node.record, select: node.select, shaping }),
		}))
	const links = expanding.flatMap((entry) => entry.links)
	if (links.length === 0) return []

	const level = await readUnknownRecords<GenericConfig>({ context, links, known: new Map() })
	const nextFrontier = expanding.flatMap(({ node, links: nodeLinks }) =>
		keptChildren<GenericConfig>({
			record: node.record,
			children: nodeLinks.flatMap((link) => {
				const child = level.get(link.id)
				return child ? [child] : []
			}),
			select: node.select,
			shaping,
		}).map((kept) => ({ ...kept, remainingDepth: node.remainingDepth - 1 })),
	)
	const deeper = await readLevels<GenericConfig>({ context, frontier: nextFrontier, shaping })
	return [level, ...deeper]
}

/** The requested root in a whole-document read: by id, or the first record of its tag for a singleton. */
function rootIn<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	recordsById: KnownRecords<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
}): TrackedRecord<GenericConfig, GenericElement> | undefined {
	const { recordsById, ref } = params
	const record =
		ref.id !== undefined
			? recordsById.get(ref.id)
			: [...recordsById.values()].find((candidate) => candidate.tagName === ref.tagName)
	return record?.tagName === ref.tagName
		? (record as TrackedRecord<GenericConfig, GenericElement>)
		: undefined
}
