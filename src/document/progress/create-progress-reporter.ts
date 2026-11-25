import type { DocumentProgress, PlanInput, ProgressReporter } from './progress.types'
import type { DocumentState } from '@/document/types'

/** One level of the plan stack. `open` drives close-previous stepping. */
type PlanFrame = {
	current: number
	total: number
	label: string
	open: boolean
}

/**
 * Real reporter — sole writer of `DocumentState.progress`. Transaction owns one
 * instance per transaction; extensions reach it via `tx.progress`.
 *
 * Model: a STACK of plans. `plan()` pushes a frame (child of the current innermost,
 * or the main when the stack is empty); `nextStep()` advances the innermost frame
 * (close-previous — `current` = COMPLETED steps); `endPlan()` pops; `runInPlan()` pushes a frame, runs its
 * body and cuts the stack back to the depth before it, on success and on a throw. The two-level
 * `DocumentState.progress` is projected from the stack: the main (stack[0]) drives
 * the bar, the deepest frame drives the `step` sub-bar and the caption.
 *
 * `signalStateChange(terminal)` is fired after every mutation so a subscriber (the
 * owning Document's reactive registry) can react. `terminal` is `true` only for the
 * final frame of an operation (an `endPlan()` or a `runInPlan()` cut that empties the stack, or
 * `forceClear()`), letting the UI flush it synchronously instead of coalescing it away.
 */
// dialecte-allow argument-mutation: the reporter is the sole writer of `DocumentState.progress`, its whole job
export function createProgressReporter(
	state: DocumentState,
	signalStateChange: (terminal: boolean) => void = () => {},
): ProgressReporter {
	const stack: PlanFrame[] = []

	function render(): void {
		state.progress = projectProgress(stack)
	}

	// Cut the stack back to `depth`: a run's frame and any a nested op left open above it, in one event. Nothing to
	// cut, nothing told.
	function cutTo(depth: number): void {
		if (stack.length <= depth) return
		stack.length = depth
		render()
		signalStateChange(depth === 0)
	}

	const reporter: ProgressReporter = {
		plan({ steps, label }) {
			stack.push({ current: 0, total: steps, label: label ?? '', open: false })
			render()
			signalStateChange(false)
		},

		nextStep(label) {
			const frame = stack.at(-1)
			if (!frame) return
			if (frame.open) frame.current++ // close the previous step
			frame.open = true
			if (label !== undefined) frame.label = label
			render()
			signalStateChange(false)
		},

		endPlan() {
			if (stack.length === 0) return
			stack.pop()
			const terminal = stack.length === 0
			render()
			signalStateChange(terminal)
		},

		async runInPlan<GenericResult>(params: {
			plan: PlanInput
			run: () => Promise<GenericResult>
		}): Promise<GenericResult> {
			const { plan, run } = params
			const depthBefore = stack.length
			reporter.plan(plan)
			try {
				return await run()
			} finally {
				cutTo(depthBefore)
			}
		},

		forceClear() {
			stack.length = 0
			state.progress = null
			signalStateChange(true)
		},
	}

	return reporter
}

/**
 * Project the plan stack onto the two-level `DocumentProgress` shape: the main frame drives the bar, the deepest the
 * caption and the sub-bar.
 */
function projectProgress(stack: readonly PlanFrame[]): DocumentProgress {
	if (stack.length === 0) return null
	const main = stack[0]
	const deepest = stack[stack.length - 1]
	return {
		current: main.current,
		total: main.total,
		label: deepest.label || main.label,
		step: stack.length > 1 ? { current: deepest.current, total: deepest.total } : null,
	}
}
