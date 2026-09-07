import type { ProgressReporter } from './progress.types'

/** Query gets this — reads never report progress, so writes are no-ops. */
export const NOOP_PROGRESS_REPORTER: ProgressReporter = Object.freeze({
	plan() {},
	nextStep() {},
	endPlan() {},
	forceClear() {},
})
