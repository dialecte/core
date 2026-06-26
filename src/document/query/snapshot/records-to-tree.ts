import { toTreeRecord } from '@/helpers'
import { invariant } from '@/utils'

import type { CollectedSnapshot } from './snapshot.types'
import type { AnyTrackedRecord, AnyTreeRecord } from '@/types'

/**
 * Assemble a `TreeRecord` from a flat, scope-bounded record set.
 *
 * Pure `records → tree`: walks from `rootId` using each record's `children`
 * refs, keeping only ids present in the live set (orphan-safe at scope
 * boundaries). When `deletedRecords` are provided they are re-attached as
 * tombstones (`status:'deleted'`) under their original parent, after the live
 * children — so the tree shows what a node looked like including pending
 * deletions. XML serialization never uses this path.
 */
export function recordsToTree(snapshot: CollectedSnapshot): AnyTreeRecord {
	const { liveRecords, deletedRecords, rootId } = snapshot

	const liveById = new Map(liveRecords.map((record) => [record.id, record]))
	const deletedById = new Map(deletedRecords.map((record) => [record.id, record]))

	const deletedByParent = new Map<string, AnyTrackedRecord[]>()
	for (const record of deletedRecords) {
		const parentId = record.parent?.id
		if (!parentId) continue
		const siblings = deletedByParent.get(parentId) ?? []
		siblings.push(record)
		deletedByParent.set(parentId, siblings)
	}

	const root = liveById.get(rootId)
	invariant(root, {
		key: 'ROOT_NOT_FOUND',
		detail: `No record found for rootId "${rootId}"`,
	})

	// Build a node by recursing within one source map. Live nodes additionally
	// re-attach any staged-deleted children as tombstones, after the live ones.
	const build = (record: AnyTrackedRecord, source: 'live' | 'deleted'): AnyTreeRecord => {
		const childMap = source === 'live' ? liveById : deletedById

		const children = record.children
			.filter((child) => childMap.has(child.id))
			.map((child) => build(childMap.get(child.id)!, source))

		const tombstones =
			source === 'live'
				? (deletedByParent.get(record.id) ?? []).map((tombstone) => build(tombstone, 'deleted'))
				: []

		return toTreeRecord({ record, tree: [...children, ...tombstones] }) as AnyTreeRecord
	}

	return build(root, 'live')
}
