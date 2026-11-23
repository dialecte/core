import { createProgressReporter } from './create-progress-reporter'
import { NOOP_PROGRESS_REPORTER } from './noop-progress-reporter'
import { runInPlan } from './run-in-plan'

import { describe, expect, it } from 'vitest'

import type { DocumentProgress, PlanInput, ProgressReporter } from './progress.types'
import type { DocumentState } from '@/document/types'

function makeState(): DocumentState {
	return { loading: false, error: null, progress: null, history: [], lastUpdate: null }
}

/** A reporter whose every rendered value is recorded, in order. */
function makeRecordedReporter(): {
	state: DocumentState
	reporter: ProgressReporter
	values: DocumentProgress[]
	terminals: boolean[]
} {
	const state = makeState()
	const values: DocumentProgress[] = []
	const terminals: boolean[] = []
	const reporter = createProgressReporter(state, (terminal) => {
		values.push(state.progress && { ...state.progress })
		terminals.push(terminal)
	})
	return { state, reporter, values, terminals }
}

/** Open `count` frames, each `L<n>` with 4 steps and its first step begun. */
function openFrames(params: { reporter: ProgressReporter; count: number }): void {
	for (let level = 1; level <= params.count; level++) {
		params.reporter.plan({ steps: 4, label: `L${level}` })
		params.reporter.nextStep()
	}
}

const OP_PLAN: PlanInput = { steps: 3 }

describe('runInPlan', () => {
	describe('a successful run -> the same progress values as a hand-written plan()/endPlan() pair', () => {
		type TestCase = { framesBefore: number }
		const testCases: Record<string, TestCase> = {
			'top level (no frame open)': { framesBefore: 0 },
			'nested under one frame': { framesBefore: 1 },
			'nested under two frames': { framesBefore: 2 },
		}
		for (const [description, { framesBefore }] of Object.entries(testCases)) {
			it(description, async () => {
				const byHand = makeRecordedReporter()
				openFrames({ reporter: byHand.reporter, count: framesBefore })
				byHand.reporter.plan(OP_PLAN)
				byHand.reporter.nextStep()
				byHand.reporter.nextStep()
				byHand.reporter.endPlan()

				const helped = makeRecordedReporter()
				openFrames({ reporter: helped.reporter, count: framesBefore })
				await expect(
					runInPlan({
						progress: helped.reporter,
						plan: OP_PLAN,
						run: async () => {
							helped.reporter.nextStep()
							helped.reporter.nextStep()
							return 'done'
						},
					}),
				).resolves.toBe('done')

				expect(helped.values).toEqual(byHand.values)
				expect(helped.terminals).toEqual(byHand.terminals)
			})
		}
	})

	describe('a run that throws -> the stack cut back to the depth before the plan, the same error thrown', () => {
		type TestCase = { framesBefore: number; framesLeftOpenInside: number }
		const testCases: Record<string, TestCase> = {
			'under 1 frame, nothing left open inside': { framesBefore: 1, framesLeftOpenInside: 0 },
			'under 2 frames, nothing left open inside': { framesBefore: 2, framesLeftOpenInside: 0 },
			'under 3 frames, nothing left open inside': { framesBefore: 3, framesLeftOpenInside: 0 },
			'under 1 frame, a nested op left 1 frame open': { framesBefore: 1, framesLeftOpenInside: 1 },
			'under 2 frames, nested ops left 2 frames open': { framesBefore: 2, framesLeftOpenInside: 2 },
		}
		for (const [description, { framesBefore, framesLeftOpenInside }] of Object.entries(testCases)) {
			it(description, async () => {
				const { state, reporter } = makeRecordedReporter()
				openFrames({ reporter, count: framesBefore })
				const before = state.progress && { ...state.progress }
				const thrown = new Error('boom')

				await expect(
					runInPlan({
						progress: reporter,
						plan: OP_PLAN,
						run: async () => {
							reporter.nextStep()
							for (let left = 0; left < framesLeftOpenInside; left++) {
								reporter.plan({ steps: 2, label: `nested ${left}` })
								reporter.nextStep()
							}
							throw thrown
						},
					}),
				).rejects.toBe(thrown)

				expect(state.progress).toEqual(before)
				// the frames before the op still step and close as before: closing them all clears the bar
				for (let level = 0; level < framesBefore; level++) reporter.endPlan()
				expect(state.progress).toBeNull()
			})
		}

		it('a top-level run that throws -> progress null, the clear flushed as terminal', async () => {
			const { state, reporter, terminals } = makeRecordedReporter()
			const thrown = new Error('boom')

			await expect(
				runInPlan({
					progress: reporter,
					plan: OP_PLAN,
					run: async () => {
						reporter.plan({ steps: 2 })
						throw thrown
					},
				}),
			).rejects.toBe(thrown)

			expect(state.progress).toBeNull()
			expect(terminals.at(-1)).toBe(true)
		})
	})

	it('two runs at once under one frame, the one opened first ends while the later one runs -> the same values as the hand-written plan()/endPlan() calls in that order', async () => {
		const byHand = makeRecordedReporter()
		openFrames({ reporter: byHand.reporter, count: 1 })
		byHand.reporter.plan(OP_PLAN)
		byHand.reporter.plan(OP_PLAN)
		byHand.reporter.endPlan()
		byHand.reporter.endPlan()

		const helped = makeRecordedReporter()
		openFrames({ reporter: helped.reporter, count: 1 })
		let releaseFirst: () => void = () => {}
		const firstMayEnd = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		let releaseLater: () => void = () => {}
		const laterMayEnd = new Promise<void>((resolve) => {
			releaseLater = resolve
		})
		const first = runInPlan({ progress: helped.reporter, plan: OP_PLAN, run: () => firstMayEnd })
		const later = runInPlan({ progress: helped.reporter, plan: OP_PLAN, run: () => laterMayEnd })
		releaseFirst()
		await expect(first).resolves.toBeUndefined()
		releaseLater()
		await expect(later).resolves.toBeUndefined()

		expect(helped.values).toEqual(byHand.values)
		expect(helped.terminals).toEqual(byHand.terminals)
	})

	describe('on the no-op reporter of a query', () => {
		it('a successful run -> its value', async () => {
			await expect(
				runInPlan({ progress: NOOP_PROGRESS_REPORTER, plan: OP_PLAN, run: async () => 7 }),
			).resolves.toBe(7)
		})

		it('a run that throws -> the same error', async () => {
			const thrown = new Error('boom')
			await expect(
				runInPlan({
					progress: NOOP_PROGRESS_REPORTER,
					plan: OP_PLAN,
					run: async () => {
						throw thrown
					},
				}),
			).rejects.toBe(thrown)
		})
	})
})
