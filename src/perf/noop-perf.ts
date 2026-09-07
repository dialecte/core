import type { Perf } from './perf.types'

/** Frozen no-op returned when perf is disabled — zero prod cost, tree-shaken. */
export const NOOP_PERF: Perf = Object.freeze({
	start() {},
	stop() {},
	count() {},
	profile(_name, fn) {
		return fn()
	},
	report() {
		return {}
	},
	log() {},
	reset() {},
})
