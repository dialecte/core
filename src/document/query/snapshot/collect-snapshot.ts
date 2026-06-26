import { findAncestors } from '../find'
import { getRecord, indexStagedDeletesByParent, overlayAllStaged } from '../get'

import { toRef } from '@/helpers'
import { invariant } from '@/utils'

import type { CollectedSnapshot } from './snapshot.types'
import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, AnyTrackedRecord, ElementsOf, TrackedRecord } from '@/types'

/**
 * Collect the scope-bounded, hooks-applied record set for a snapshot.
 *
 * Reads go through `getRecord`, which overlays staged ops (staged → cache →
 * store), so the result reflects the uncommitted transaction state. The whole
 * document (no `ref`, no `depth`) is collected via one bulk read + overlay; any
 * bounded scope (a `ref`, or a `depth` from the root) walks the tree (down
 * `depth`, up `ancestors`, optional `siblings`).
 */
export async function collectSnapshotRecords<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	ref?: Ref<GenericConfig, ElementsOf<GenericConfig>>
	ancestors?: number
	siblings?: boolean | { expand?: boolean }
	depth?: number
	includeDeleted?: boolean
}): Promise<CollectedSnapshot> {
	const { context, ref, ancestors = 0, depth, includeDeleted = false } = params

	// Fast path: whole document with no depth bound — one bulk read + overlay.
	if (!ref && depth === undefined) {
		return collectFullDocument({ context, includeDeleted })
	}

	const siblings = params.siblings ?? false
	const includeSiblings = siblings === true || (typeof siblings === 'object' && siblings !== null)
	const expandSiblings =
		typeof siblings === 'object' && siblings !== null && siblings.expand === true

	// Start at the given ref, or the document root when only a depth bound is set.
	const startRef =
		ref ??
		({ tagName: context.dialecteConfig.rootElementName } as Ref<
			GenericConfig,
			ElementsOf<GenericConfig>
		>)

	const live = new Map<string, AnyTrackedRecord>()
	const deletedById = new Map<string, AnyTrackedRecord>()

	// Index staged deletes by parent once (single pass over ops); excludes
	// created-then-deleted ids. Each node then looks up its tombstones in O(1).
	const deletedByParentId = includeDeleted
		? indexStagedDeletesByParent(context.stagedOperations)
		: undefined

	// Recursively pull a staged-deleted subtree rooted at `parentId`.
	const collectDeletedUnder = (parentId: string): void => {
		if (!deletedByParentId) return
		for (const deleted of deletedByParentId.get(parentId) ?? []) {
			if (deletedById.has(deleted.id)) continue
			deletedById.set(deleted.id, deleted)
			collectDeletedUnder(deleted.id)
		}
	}

	// Descend from a record into `live`, bounded by `depth`. Reused for the start
	// record and, when `expandSiblings` is set, for each sibling's subtree.
	const descend = async (
		record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>,
		level: number,
	): Promise<void> => {
		live.set(record.id, record)
		collectDeletedUnder(record.id)

		if (depth !== undefined && level >= depth) return
		for (const childRef of record.children) {
			const child = await getRecord({ context, ref: toRef(childRef) })
			if (child) await descend(child, level + 1)
		}
	}

	// Resolve the start record (`ref.id` may be undefined for singletons / root).
	const startRecord = await getRecord({ context, ref: startRef })
	invariant(startRecord, {
		key: 'ELEMENT_NOT_FOUND',
		detail: 'No record found for the provided ref',
	})
	let rootId = startRecord.id

	await descend(startRecord, 0)

	// Ascend. `siblings` needs at least the immediate parent, so ensure one level.
	// (With no explicit ref the start is the root, which has no ancestors/siblings.)
	const ancestorDepth = Math.max(ancestors, includeSiblings ? 1 : 0)

	if (ancestorDepth > 0) {
		const ancestorRecords = await findAncestors({
			context,
			ref: startRef,
			options: { depth: ancestorDepth, order: 'bottom-up' },
		})

		for (const ancestor of ancestorRecords) {
			live.set(ancestor.id, ancestor)
			rootId = ancestor.id
		}

		// Spine-wide siblings: at every level of the ancestor spine, add the spine
		// node's siblings (its parent's other children). Shallow by default;
		// `expand` pulls each sibling's subtree (still bounded by `depth`).
		if (includeSiblings) {
			// Bottom-up spine: [ref, parent, grandparent, …, outermost].
			const spine = [startRecord, ...ancestorRecords]
			for (let level = 0; level < spine.length - 1; level++) {
				const node = spine[level]
				const parent = spine[level + 1]
				for (const childRef of parent.children) {
					if (childRef.id === node.id) continue
					const sibling = await getRecord({ context, ref: toRef(childRef) })
					if (!sibling) continue
					if (expandSiblings) {
						await descend(sibling, 0)
					} else {
						live.set(sibling.id, sibling)
					}
				}
			}
		}
	}

	return finalize({ live, deletedById, rootId })
}

async function collectFullDocument<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	includeDeleted?: boolean
}): Promise<CollectedSnapshot> {
	const { context, includeDeleted = false } = params

	const rawRecords = await context.store.getByDocumentId(context.documentId)
	const { live, deleted } = overlayAllStaged({
		rawRecords,
		stagedOperations: context.stagedOperations,
		includeDeleted,
	})

	let rootId: string | undefined
	for (const record of live.values()) {
		if (record.tagName === context.dialecteConfig.rootElementName) {
			rootId = record.id
			break
		}
	}
	invariant(rootId, {
		key: 'ROOT_NOT_FOUND',
		detail: `No ${context.dialecteConfig.rootElementName} root element found in document`,
	})

	const deletedById = new Map(deleted.map((record) => [record.id, record]))
	return finalize({ live, deletedById, rootId })
}

/**
 * Rebuild every record's `children` to reference only ids kept in scope, so the
 * flat set is internally consistent for both tree assembly and XML serialization
 * (avoids dangling child refs at depth boundaries, excluded siblings, deletes).
 */
function finalize(params: {
	live: Map<string, AnyTrackedRecord>
	deletedById: Map<string, AnyTrackedRecord>
	rootId: string
}): CollectedSnapshot {
	const { live, deletedById, rootId } = params

	const liveIds = new Set(live.keys())
	const liveRecords = Array.from(live.values()).map((record) => ({
		...record,
		children: record.children.filter((child) => liveIds.has(child.id)),
	}))

	const deletedIds = new Set(deletedById.keys())
	const deletedRecords = Array.from(deletedById.values()).map((record) => ({
		...record,
		children: record.children.filter((child) => deletedIds.has(child.id)),
	}))

	return { liveRecords, deletedRecords, rootId }
}
