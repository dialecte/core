/** How many records of one tag a transaction creates, updates and deletes. */
export type OperationCounts = { created: number; updated: number; deleted: number }

/**
 * What a transaction writes, one count per record (several staged writes to the same record count
 * once, as the commit merges them): totals, and per tag in tag order.
 */
export type OperationsSummary = {
	creates: number
	updates: number
	deletes: number
	byTag: Record<string, OperationCounts>
}
