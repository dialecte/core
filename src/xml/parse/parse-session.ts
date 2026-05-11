import type { AnyRelationship, AnyRawRecord } from '@/types'

/**
 * ParseSession - encapsulates mutable state for a single XML parse run.
 *
 * Each import gets its own session - no shared state, safe for parallel imports.
 */
export class ParseSession {
	private pendingChildren: Map<string, AnyRelationship[]> = new Map()

	/**
	 * Register a child relationship that cannot be resolved yet
	 * because the parent was already flushed in a previous batch.
	 */
	registerPendingChild(parentId: string, child: AnyRelationship): void {
		const existing = this.pendingChildren.get(parentId)
		if (existing) {
			existing.push(child)
		} else {
			this.pendingChildren.set(parentId, [child])
		}
	}

	/**
	 * Resolve pending children relationships for records in the current batch.
	 * Mutates records in place for performance (batch is owned by caller).
	 */
	resolveChildrenForBatch(batch: AnyRawRecord[]): AnyRawRecord[] {
		for (const record of batch) {
			const pending = this.pendingChildren.get(record.id)
			if (pending && pending.length > 0) {
				record.children.push(...pending)
				this.pendingChildren.delete(record.id)
			}
		}
		return batch
	}

	/** Number of unresolved parent-child relationships (for diagnostics) */
	get pendingCount(): number {
		return this.pendingChildren.size
	}
}
