/** The connections of each project name opened and not closed since, in this realm. */
export type OpenConnections = {
	markOpen: (params: { name: string; connection: object }) => void
	markClosed: (params: { name: string; connection: object }) => void
	/** How many connections of the name besides `connection` (every one when none is given) are open. */
	others: (params: { name: string; connection?: object }) => number
}
