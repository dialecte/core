/** A record as a commit writes it: its id, its tag and its parent (`null` for the root). */
export type PlacedRecord = { id: string; tagName: string; parent: { id: string } | null }

/**
 * The merged writes of one commit: created and updated records as written, deleted records as they were stored.
 */
export type CommitWrites = {
	creates: ReadonlyArray<PlacedRecord>
	updates: ReadonlyArray<PlacedRecord>
	deletes: ReadonlyArray<PlacedRecord>
}
