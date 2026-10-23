import { NOOP_PERF } from './noop-perf'

import type { Perf, PerfReport, PerfSpan } from './perf.types'

const ROOT_PREFIX = 'dialecte::'

/**
 * Dev metrics on the platform User Timing API. Disabled builds get `NOOP_PERF`.
 *
 * `report()` reads the timeline FRESH on demand (no `PerformanceObserver`, whose
 * callback is queued for after the current task — `stop(); report()` in the same
 * tick would otherwise read stale data). Filtering by the `dialecte::` root
 * prefix excludes measures any other library placed on the shared timeline.
 *
 * `timeline: false` keeps the spans in this perf only (`report()` and `snapshot()` read them, the
 * shared timeline never sees them): what a perf whose spans another realm merges uses, so the realm
 * running it holds them once.
 */
export function createPerf({
	enabled,
	timeline = true,
}: {
	enabled: boolean
	timeline?: boolean
}): Perf {
	if (!enabled) return NOOP_PERF

	const pending = new Map<string, { mark: string; startTime: number }[]>() // qualified name → stack of open spans
	const counters = new Map<string, number>() // qualified name → tally
	const accumulators = new Map<string, { calls: number; totalMs: number }>() // qualified name → summed wall-time
	const spans: PerfSpan[] = [] // with `timeline: false`: this perf's spans, by unqualified name
	let seq = 0

	/** Keep a span this perf measured or merged, on the shared timeline too unless kept off it. */
	function recordSpan(span: PerfSpan): void {
		if (!timeline) {
			spans.push(span)
			return
		}
		performance.measure(ROOT_PREFIX + span.name, {
			start: span.startTime,
			duration: span.duration,
		})
	}

	/** The spans `report()` and `snapshot()` read: the shared timeline's, or this perf's own. */
	function readSpans(): PerfSpan[] {
		if (!timeline) return spans
		return performance
			.getEntriesByType('measure')
			.filter((entry) => entry.name.startsWith(ROOT_PREFIX))
			.map((entry) => ({
				name: entry.name.slice(ROOT_PREFIX.length),
				startTime: entry.startTime,
				duration: entry.duration,
			}))
	}

	function addToAccumulator(qualified: string, calls: number, totalMs: number): void {
		const bucket =
			accumulators.get(qualified) ??
			accumulators.set(qualified, { calls: 0, totalMs: 0 }).get(qualified)!
		bucket.calls += calls
		bucket.totalMs += totalMs
	}

	const perf: Perf = {
		start(name) {
			const qualified = ROOT_PREFIX + name
			const mark = `${qualified}:${++seq}`
			if (timeline) performance.mark(mark)
			const stack = pending.get(qualified) ?? pending.set(qualified, []).get(qualified)!
			stack.push({ mark, startTime: performance.now() })
		},

		stop(name) {
			const qualified = ROOT_PREFIX + name
			const open = pending.get(qualified)?.pop()
			if (!open) return // stop without a matching start → no-op
			if (timeline) {
				performance.measure(qualified, open.mark)
				performance.clearMarks(open.mark) // drop the transient anchor
				return
			}
			spans.push({ name, startTime: open.startTime, duration: performance.now() - open.startTime })
		},

		count(name) {
			const qualified = ROOT_PREFIX + name
			counters.set(qualified, (counters.get(qualified) ?? 0) + 1)
		},

		time(name, fn) {
			const qualified = ROOT_PREFIX + name
			const t0 = performance.now()
			try {
				return fn()
			} finally {
				addToAccumulator(qualified, 1, performance.now() - t0)
			}
		},

		profile(name, fn) {
			if (typeof console.profile !== 'function') return fn() // node/headless → skip
			console.profile(ROOT_PREFIX + name)
			return Promise.resolve(fn()).finally(() => console.profileEnd(ROOT_PREFIX + name))
		},

		report() {
			const out: PerfReport = {}
			for (const { name, duration } of readSpans()) {
				const bucket = (out[name] ??= { calls: 0, totalMs: 0, avgMs: 0 })
				bucket.calls++
				bucket.totalMs += duration
				bucket.avgMs = bucket.totalMs / bucket.calls
			}
			return addTotals(out)
		},

		log() {
			console.table(perf.report())
		},

		reset() {
			if (timeline) {
				performance.clearMarks()
				performance.clearMeasures()
			}
			pending.clear()
			spans.length = 0
			counters.clear()
			accumulators.clear()
		},

		snapshot() {
			return { timeOrigin: performance.timeOrigin, spans: [...readSpans()], totals: addTotals({}) }
		},

		merge({ report, prefix }) {
			const shift = report.timeOrigin - performance.timeOrigin
			for (const span of report.spans) {
				recordSpan({
					name: `${prefix}::${span.name}`,
					startTime: Math.max(0, span.startTime + shift),
					duration: span.duration,
				})
			}
			for (const [name, entry] of Object.entries(report.totals)) {
				const qualified = `${ROOT_PREFIX}${prefix}::${name}`
				if (entry.calls > 0) addToAccumulator(qualified, entry.calls, entry.totalMs)
				if (entry.count !== undefined) {
					counters.set(qualified, (counters.get(qualified) ?? 0) + entry.count)
				}
			}
		},
	}

	/**
	 * The tallies - `time` and `count` names - by unqualified name, folded into `out` (a name both
	 * measured and tallied is one entry), as `report()` shows them.
	 */
	function addTotals(out: PerfReport): PerfReport {
		// Overlay time accumulators — merge into the same calls/totalMs bucket.
		for (const [qualified, acc] of accumulators) {
			const name = qualified.slice(ROOT_PREFIX.length)
			const bucket = (out[name] ??= { calls: 0, totalMs: 0, avgMs: 0 })
			bucket.calls += acc.calls
			bucket.totalMs += acc.totalMs
			bucket.avgMs = bucket.calls ? bucket.totalMs / bucket.calls : 0
		}
		// Overlay counters — a counted-only name gets zeroed timing fields.
		for (const [qualified, count] of counters) {
			const name = qualified.slice(ROOT_PREFIX.length)
			const bucket = (out[name] ??= { calls: 0, totalMs: 0, avgMs: 0 })
			bucket.count = count
		}
		return out
	}

	return perf
}
