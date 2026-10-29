/** A test file that runs in one tier only, and why. */
export type TierOnlyTestFile = {
	/** From the package root. */
	path: string
	/** What it needs that the other tier does not have. */
	why: string
}
