/**
 * Id order, as an IndexedDB key range answers: strings compared by UTF-16 code unit, not by locale.
 * Every list read of a store answers in this order.
 */
export function compareById(left: { id: string }, right: { id: string }): number {
	if (left.id < right.id) return -1
	return left.id > right.id ? 1 : 0
}
