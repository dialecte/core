/**
 * The ids held by every one of the sets, read from the smallest set first: each id of it is looked up in the
 * others. No set gives nothing. Unordered (the smallest set's iteration order).
 *
 * @internal the AND of an attribute lookup's entries, in the in-memory store and the staged attribute index
 */
export function idsInEvery(sets: ReadonlyArray<ReadonlySet<string>>): string[] {
	const [smallest, ...others] = [...sets].sort((left, right) => left.size - right.size)
	if (!smallest) return []
	return [...smallest].filter((id) => others.every((ids) => ids.has(id)))
}
