import type { ProgressReporter } from './progress.types'
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
 * (close-previous — `current` = COMPLETED steps); `endPlan()` pops. The two-level
 * `DocumentState.progress` is projected from the stack: the main (stack[0]) drives
 * the bar, the deepest frame drives the `step` sub-bar and the caption.
 *
 * `signalStateChange(terminal)` is fired after every mutation so a subscriber (the
 * owning Document's reactive registry) can react. `terminal` is `true` only for the
 * final frame of an operation (an `endPlan()` that empties the stack, or
 * `forceClear()`), letting the UI flush it synchronously instead of coalescing it away.
 */
export function createProgressReporter(
	state: DocumentState,
	signalStateChange: (terminal: boolean) => void = () => {},
): ProgressReporter {
	let stack: PlanFrame[] = []

	// Project the plan stack onto the two-level DocumentProgress shape.
	const render = (): void => {
		if (stack.length === 0) {
			state.progress = null
			return
		}
		const main = stack[0]
		const deepest = stack[stack.length - 1]
		state.progress = {
			current: main.current,
			total: main.total,
			label: deepest.label || main.label,
			step: stack.length > 1 ? { current: deepest.current, total: deepest.total } : null,
		}
	}

	return {
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

		forceClear() {
			stack = []
			state.progress = null
			signalStateChange(true)
		},
	}
}
