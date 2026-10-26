/** The operations a store is running: counted, and waited for by what must not cut them short. */
export type RunningOperations = {
	/** How many are running. */
	readonly count: number
	start: () => void
	end: () => void
	/** Resolves once none is running (at once when none is). */
	whenIdle: () => Promise<void>
}
