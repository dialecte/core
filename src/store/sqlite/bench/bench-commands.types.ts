import type { CDPSession } from 'playwright'

// The bench's node side (its vitest browser commands) and what it shares with the pages: nothing here reaches
// the library's sources, so the vitest config that loads the commands stays a node-only program.

export type BenchFixtureName =
	| 'composed-50-indented'
	| 'composed-50-compact'
	| 'composed-100-indented'
	| 'composed-100-compact'
	| 'composed-500-indented'
	| 'composed-500-compact'
	| 'composed-catalogue-small'
	| 'structural-50'
	| 'structural-100'
	| 'structural-500'

/** What the node side knows of a fixture file: where the browser fetches it, and its counts. */
export type BenchFixture = {
	name: BenchFixtureName
	url: string
	path: string
	bytes: number
	records: number
}

/** From the worker's CPU profile: GC self time over busy (non-idle) time, plus named functions' self time. */
export type GcShare = {
	gcMs: number
	busyMs: number
	idleMs: number
	sampledMs: number
	share: number
	named: Record<string, number>
	/** the functions with the most self time, worker-wide */
	top: Array<{ name: string; ms: number }>
}

/** The parts of a CDP `Profiler.stop` profile the GC share needs. */
export type BenchCpuProfile = {
	nodes: Array<{ id: number; callFrame: { functionName: string } }>
	samples: number[]
	timeDeltas: number[]
	startTime: number
	endTime: number
}

/** The page's CDP session and the worker session it relays to (auto-attach without flatten). */
export type BenchProfileState = {
	session: CDPSession
	workerSessionId: string
	nextId: number
	pending: Map<number, (message: { result?: unknown; error?: { message: string } }) => void>
}

/** What a page asks `benchWaitForQuiet`: wait while the 1-minute load is at or above `maxLoad`, at most `maxWaitMs`. */
export type BenchWaitForQuietParams = { maxLoad: number; maxWaitMs: number }

/** What a page asks `benchRecord` to write: one result file named `name`. */
export type BenchRecordParams = { name: string; data: unknown }

/** What a page asks `benchProfileStart`: the worker to profile, and the sampling interval. */
export type BenchProfileStartParams = { workerUrlIncludes: string; samplingIntervalUs: number }

/** What a page asks `benchProfileStop`: which profile nodes are GC, idle, and which functions to name. */
export type BenchProfileStopParams = {
	gcNode: string
	idleNodes: string[]
	namedFunctions: string[]
}
