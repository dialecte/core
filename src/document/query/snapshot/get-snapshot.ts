import { applyOmit, applyOrder, applyUnwrap } from '../tree-filter'
import { collectSnapshotRecords } from './collect-snapshot'
import { recordsToTree } from './records-to-tree'

import { toRef } from '@/helpers'
import { buildXmlDocument, xmlDocumentToString } from '@/xml'

import type { CollectedSnapshot, GetSnapshotOptions, SnapshotResult } from './snapshot.types'
import type { Context } from '@/document'
import type { AnyDialecteConfig, AnyTreeRecord, ElementsOf } from '@/types'

/**
 * Produce a snapshot of the (uncommitted) document state as a tree, an XML
 * string, or both.
 *
 * Collects the scope-bounded, hooks-applied record set once, then derives the
 * requested output(s) from it (`records → tree`, `records → xml` — never the
 * inverse). Reads overlay staged operations, so calling this on a live
 * transaction (or a prepared transaction's `query`) reflects what `commit()`
 * would write.
 *
 * `omit`/`unwrap` shape the tree output only (shared with `getTree`); the XML
 * always reflects the full, unfiltered document — it is what `commit()` writes.
 */
export async function getSnapshot<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	options?: GetSnapshotOptions<GenericConfig>
}): Promise<AnyTreeRecord | string | SnapshotResult> {
	const { context, options = {} } = params
	const { ref, ancestors, siblings, depth, includeDeleted, omit, unwrap, as = 'tree' } = options

	const collected = await collectSnapshotRecords({
		context,
		ref: ref ? toRef(ref) : undefined,
		ancestors,
		siblings,
		depth,
		includeDeleted,
	})

	if (as === 'xml') return toXmlString(context, collected, options.declareNamespaces)

	const tree = toTree(context, collected, { omit, unwrap })
	if (as === 'tree') return tree

	return { tree, xmlString: toXmlString(context, collected, options.declareNamespaces) }
}

/**
 * Assemble the tree from the collected set, then apply the tree-only filters
 * (`omit`, then `unwrap`) — mirroring `getTree`'s order, including the
 * auto-unwrap of transparent elements when `unwrap` is not provided.
 */
function toTree<GenericConfig extends AnyDialecteConfig>(
	context: Context<GenericConfig>,
	collected: CollectedSnapshot,
	filters: {
		omit?: GetSnapshotOptions<GenericConfig>['omit']
		unwrap?: ElementsOf<GenericConfig>[]
	},
): AnyTreeRecord {
	let tree = recordsToTree(collected)

	tree = applyOmit({ tree, omit: filters.omit })

	const transparentElements = context.dialecteConfig.transparentElements as
		| readonly string[]
		| undefined
	const unwrapTagNames =
		filters.unwrap ?? (transparentElements?.length ? [...transparentElements] : undefined)

	if (unwrapTagNames?.length) {
		tree = applyUnwrap({ tree, unwrapTagNames: unwrapTagNames as ElementsOf<GenericConfig>[] })
	}

	// Final post-pass: order children by the config sequence (matches XML order).
	tree = applyOrder({ tree, childrenConfig: context.dialecteConfig.children })

	return tree
}

function toXmlString<GenericConfig extends AnyDialecteConfig>(
	context: Context<GenericConfig>,
	collected: CollectedSnapshot,
	declareNamespaces?: boolean,
): string {
	const xmlDocument = buildXmlDocument({
		records: collected.liveRecords,
		config: context.dialecteConfig,
		rootId: collected.rootId,
		declareNamespaces,
	})
	return xmlDocumentToString(xmlDocument)
}
