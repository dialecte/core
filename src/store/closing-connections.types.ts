/** The connections of each project name closed while operations of theirs still run, in this realm. */
export type ClosingConnections = {
	/** A connection of the name closed: its running operations settle with `until`. */
	markClosing: (params: { name: string; until: Promise<unknown> }) => void
	/** Settles once no connection of the name closed with operations running has any left. */
	settled: (params: { name: string }) => Promise<void>
}
