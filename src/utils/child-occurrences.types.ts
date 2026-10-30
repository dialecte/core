/** How often a child may appear under an element: `max` undefined = unbounded. */
export type ChildOccurrences = {
	readonly min: number
	readonly max: number | undefined
}
