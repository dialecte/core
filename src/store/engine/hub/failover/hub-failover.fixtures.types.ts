import type { Browser } from 'playwright'

export type FailoverBrowserName = 'chromium' | 'firefox'

export type LaunchedBrowser = { name: FailoverBrowserName; browser: Browser }

/**
 * One failover measured: the host's tab closed -> a read of the other tab answered by the next engine (Node's clock,
 * from just before the close), the engine's worker seen in the host's tab before and in the reader's after; or why
 * the run failed; with the machine's 1, 5 and 15-minute load when it ended.
 */
export type FailoverRun = { run: number; load: number[] } & (
	| { readAnsweredMs: number; hostChanged: true }
	| { failed: string }
)

/**
 * The source a report was measured on: its commit, the tree it built (the working files, untracked ones included,
 * written as a tree - the commit's own tree on a clean checkout), and how many files differed from that commit.
 */
export type FailoverSource = { commit: string; tree: string; uncommittedFiles: number }

/** What a child of another origin, bound through a port its parent made, answered. */
export type CrossOriginChildOutcome = {
	readWhileBound: unknown
	readOnceUnbound: unknown
}

export type FailoverReport = {
	browser: FailoverBrowserName
	at: string
	source: FailoverSource
	runs: FailoverRun[]
	crossOriginChild: CrossOriginChildOutcome | { failed: string }
}

/** A browser that could not be measured at all (it did not start). */
export type FailedBrowser = { browser: FailoverBrowserName; failed: string }
