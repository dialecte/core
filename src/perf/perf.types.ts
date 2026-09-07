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
	/** Open a span. Name-keyed pair (like `console.time`); name = `layer::op`. */
	start(name: string): void
	/** Close the most recent open span for `name`. Unmatched `stop` is a no-op. */
	stop(name: string): void
	/**
	 * O(1) tally for a hot per-node primitive (e.g. store round-trips, cache
	 * hits/misses) — cheaper than a span and safe in a node loop where per-call
	 * `start`/`stop` would flood the timeline. Surfaced as `count` in `report()`.
	 */
	count(name: string): void
	/** Run `fn` inside a DevTools CPU profile (no-op in node/headless). */
	profile<GenericResult>(name: string, fn: () => Promise<GenericResult>): Promise<GenericResult>
	/** Aggregate the timeline synchronously on demand — no `PerformanceObserver`. */
	report(): PerfReport
	/** `console.table(report())`. */
	log(): void
	/** Clear all marks + measures (bound memory between measured scenarios). */
	reset(): void
}
