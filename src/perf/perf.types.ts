/**
 * Aggregated dev metrics, keyed by the caller-supplied `<layer>::<name>` (the
 * fixed `dialecte::` root prefix is stripped back off in `report()`). `count` is
 * present for names passed to `count()` (a counted-only name reports zeroed timing
 * fields); it is the O(1) alternative to timing a hot per-node primitive.
 */
export type PerfReport = Record<
	string,
	{ calls: number; totalMs: number; avgMs: number; count?: number }
>

/** One span a perf measured, on the clock of its realm (ms since that realm's `timeOrigin`). */
export type PerfSpan = { name: string; startTime: number; duration: number }

/**
 * What a perf hands to another realm: its spans on its own clock, the realm's `timeOrigin` to shift
 * them by, and its tallies (`time` and `count` names), keyed like `report()`. Plain data.
 */
export type PerfSnapshot = {
	timeOrigin: number
	spans: PerfSpan[]
	totals: PerfReport
}

/**
 * Dev-only perf helper built on the platform User Timing API
 * (`performance.mark`/`measure`). Spans live on the standard `performance`
 * timeline, so they are readable by DevTools and by an agent via
 * `performance.getEntriesByType('measure')`. Disabled builds get a frozen no-op
 * (`report()` → `{}`), tree-shaken to zero prod cost.
 *
 * Naming convention: callers pass `<layer>::<name>` (e.g. `scl::importTypes`);
 * `createPerf` prepends the fixed `dialecte::` root.
 */
export type Perf = {
	/**
	 * Open a span. Name-keyed pair (like `console.time`); name = `layer::op`.
	 *
	 * @intent time a code section in dev, measure how long an operation takes
	 */
	start(name: string): void
	/**
	 * Close the most recent open span for `name`. Unmatched `stop` is a no-op.
	 *
	 * @intent end a timed section opened with start
	 */
	stop(name: string): void
	/**
	 * O(1) tally for a hot per-node primitive (e.g. store round-trips, cache
	 * hits/misses) — cheaper than a span and safe in a node loop where per-call
	 * `start`/`stop` would flood the timeline. Surfaced as `count` in `report()`.
	 *
	 * @intent count store reads or cache hits in dev, tally calls of a hot function cheaply
	 */
	count(name: string): void
	/**
	 * O(1) wall-time accumulator: runs `fn`, adds its elapsed time to a running
	 * total keyed by `name` WITHOUT emitting a timeline measure per call (unlike
	 * `start`/`stop`). Surfaced as calls/totalMs/avgMs in `report()`. Use to time a
	 * hot per-node primitive (e.g. the SAX handlers) where millions of measures
	 * would flood the timeline.
	 *
	 * @intent accumulate time spent in a hot per-node function, time a callback without flooding the timeline
	 */
	time<GenericResult>(name: string, fn: () => GenericResult): GenericResult
	/**
	 * Run `fn` inside a DevTools CPU profile (no-op in node/headless).
	 *
	 * @intent capture a CPU profile of an async operation in DevTools
	 */
	profile<GenericResult>(name: string, fn: () => Promise<GenericResult>): Promise<GenericResult>
	/**
	 * Aggregate the timeline synchronously on demand — no `PerformanceObserver`.
	 *
	 * @intent read collected perf metrics, assert on store read counts in a test
	 */
	report(): PerfReport
	/**
	 * Print the perf report as a console table (`console.table(report())`).
	 *
	 * @intent print perf metrics to the console
	 */
	log(): void
	/**
	 * Clear all marks + measures (bound memory between measured scenarios).
	 *
	 * @intent reset perf metrics between measured scenarios
	 */
	reset(): void
	/**
	 * This realm's spans (the shared timeline's; this perf's own with `timeline: false`) and this perf's tallies, to hand to another realm.
	 *
	 * @intent send a worker's or another realm's timings to the page, collect perf from the store engine
	 */
	snapshot(): PerfSnapshot
	/**
	 * Fold another realm's snapshot in under `<prefix>::<name>`: its spans placed on this realm's
	 * timeline (shifted by the difference of the two `timeOrigin`s), its tallies added to this one's.
	 *
	 * @intent combine timings measured in a worker with the page's, one report across realms
	 */
	merge(params: { report: PerfSnapshot; prefix: string }): void
}
