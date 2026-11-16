import type { AnyRawRecord, AnyRelationship } from '@/types'

/**
 * The children of one parse whose parent left the parser's stack before they closed, by parent id: they are added to
 * their parent when it is handed in a batch.
 */
export type PendingChildren = ReadonlyMap<string, readonly AnyRelationship[]>

/** What one parse's pending children answer: a child to add later, a batch completed with the children it waits for. */
export type PendingChildrenOfParse = {
	/** Keep a child for its parent, to add when the parent is handed in a batch. */
	register: (params: { parentId: string; child: AnyRelationship }) => void
	/** The batch, its records completed with the children kept for them. */
	resolve: (params: { batch: AnyRawRecord[] }) => AnyRawRecord[]
}

/** A batch completed with its pending children, and the children still waiting for a later batch. */
export type PendingResolution = {
	pending: PendingChildren
	batch: AnyRawRecord[]
}
