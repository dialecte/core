import { planStackOf } from './create-progress-reporter'

import type { PlanInput, ProgressReporter } from './progress.types'

/**
 * Run `run` inside one progress plan: on success the plan ends as a hand-written `plan()`/`endPlan()` pair would
 * (unless a run beside it that threw already cut it);
 * on a throw the plan stack is cut back to the depth it had before this plan (its own frame and any frame a nested
 * op left open), then the error is thrown again.
 *
 * @internal core's own plan openers (deepClone) run their plan through it
 */
export async function runInPlan<GenericResult>(params: {
	progress: ProgressReporter
	plan: PlanInput
	run: () => Promise<GenericResult>
}): Promise<GenericResult> {
	const { progress, plan, run } = params
	const stack = planStackOf(progress)
	const depthBefore = stack?.depth() ?? 0

	progress.plan(plan)
	let result: GenericResult
	try {
		result = await run()
	} catch (error) {
		if (stack) stack.unwindTo(depthBefore)
		else progress.endPlan()
		throw error
	}
	// a run beside this one that threw may have cut this frame already: end it only while it is still there
	if (!stack || stack.depth() > depthBefore) progress.endPlan()
	return result
}
