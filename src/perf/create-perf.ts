import { NOOP_PERF } from './noop-perf'

import type { Perf, PerfReport } from './perf.types'

const ROOT_PREFIX = 'dialecte::'

/**
 * Dev metrics on the platform User Timing API. Disabled builds get `NOOP_PERF`.
 *
 * `report()` reads the timeline FRESH on demand (no `PerformanceObserver`, whose
 * callback is queued for after the current task — `stop(); report()` in the same
 * tick would otherwise read stale data). Filtering by the `dialecte::` root
 * prefix excludes measures any other library placed on the shared timeline.
 */
export function createPerf({ enabled }: { enabled: boolean }): Perf {
	if (!enabled) return NOOP_PERF

	const pending = new Map<string, string[]>() // qualified name → stack of start-mark ids
	const counters = new Map<string, number>() // qualified name → tally
	let seq = 0

	const perf: Perf = {
		start(name) {
			const qualified = ROOT_PREFIX + name
			const mark = `${qualified}:${++seq}`
			performance.mark(mark)
			const stack = pending.get(qualified) ?? pending.set(qualified, []).get(qualified)!
			stack.push(mark)
		},

		stop(name) {
			const qualified = ROOT_PREFIX + name
			const mark = pending.get(qualified)?.pop()
			if (!mark) return // stop without a matching start → no-op
			performance.measure(qualified, mark)
			performance.clearMarks(mark) // drop the transient anchor
		},

		count(name) {
			const qualified = ROOT_PREFIX + name
			counters.set(qualified, (counters.get(qualified) ?? 0) + 1)
		},

		profile(name, fn) {
			if (typeof console.profile !== 'function') return fn() // node/headless → skip
			console.profile(ROOT_PREFIX + name)
			return Promise.resolve(fn()).finally(() => console.profileEnd(ROOT_PREFIX + name))
		},

		report() {
			const out: PerfReport = {}
			for (const entry of performance.getEntriesByType('measure')) {
				if (!entry.name.startsWith(ROOT_PREFIX)) continue
				const name = entry.name.slice(ROOT_PREFIX.length)
				const bucket = (out[name] ??= { calls: 0, totalMs: 0, avgMs: 0 })
				bucket.calls++
				bucket.totalMs += entry.duration
				bucket.avgMs = bucket.totalMs / bucket.calls
			}
			// Overlay counters — a counted-only name gets zeroed timing fields.
			for (const [qualified, count] of counters) {
				const name = qualified.slice(ROOT_PREFIX.length)
				const bucket = (out[name] ??= { calls: 0, totalMs: 0, avgMs: 0 })
				bucket.count = count
			}
			return out
		},

		log() {
			console.table(perf.report())
		},

		reset() {
			performance.clearMarks()
			performance.clearMeasures()
			counters.clear()
		},
	}

	return perf
}
