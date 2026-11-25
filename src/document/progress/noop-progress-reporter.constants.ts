import type { ProgressReporter } from './progress.types'

/** Query gets this — reads never report progress, so writes are no-ops. */
export const NOOP_PROGRESS_REPORTER: ProgressReporter = Object.freeze({
	plan() {},
	nextStep() {},
	endPlan() {},
	// async, so a run that throws synchronously rejects, as on the real reporter
	async runInPlan<GenericResult>(params: {
		run: () => Promise<GenericResult>
	}): Promise<GenericResult> {
		return await params.run()
	},
	forceClear() {},
})
