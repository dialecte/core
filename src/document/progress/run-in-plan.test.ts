import { createProgressReporter } from './create-progress-reporter'
import { NOOP_PROGRESS_REPORTER } from './noop-progress-reporter.constants'

import { describe, expect, expectTypeOf, it } from 'vitest'

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
		values.push(
			state.progress && {
				...state.progress,
				step: state.progress.step && { ...state.progress.step },
			},
		)
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

/** Close `count` frames by hand: what a caller does with the frames it opened. */
function closeFrames(params: { reporter: ProgressReporter; count: number }): void {
	for (let level = 0; level < params.count; level++) params.reporter.endPlan()
}

const OP_PLAN: PlanInput = { steps: 3 }

describe('tx.progress.runInPlan', () => {
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
					helped.reporter.runInPlan({
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

	it('runs nested three deep, each stepping its own plan -> the values and terminals of the same nest written by hand', async () => {
		const byHand = makeRecordedReporter()
		byHand.reporter.plan({ steps: 2, label: 'outer' })
		byHand.reporter.nextStep()
		byHand.reporter.plan({ steps: 3, label: 'middle' })
		byHand.reporter.nextStep()
		byHand.reporter.plan({ steps: 4 })
		byHand.reporter.nextStep()
		byHand.reporter.nextStep()
		byHand.reporter.endPlan()
		byHand.reporter.nextStep('middle again')
		byHand.reporter.endPlan()
		byHand.reporter.nextStep()
		byHand.reporter.endPlan()

		const helped = makeRecordedReporter()
		const { reporter } = helped
		await expect(
			reporter.runInPlan({
				plan: { steps: 2, label: 'outer' },
				run: async () => {
					reporter.nextStep()
					await reporter.runInPlan({
						plan: { steps: 3, label: 'middle' },
						run: async () => {
							reporter.nextStep()
							await reporter.runInPlan({
								plan: { steps: 4 },
								run: async () => {
									reporter.nextStep()
									reporter.nextStep()
								},
							})
							reporter.nextStep('middle again')
						},
					})
					reporter.nextStep()
					return 3
				},
			}),
		).resolves.toBe(3)

		expect(helped.values).toEqual(byHand.values)
		expect(helped.terminals).toEqual(byHand.terminals)
		expect(helped.state.progress).toBeNull()
	})

	describe('a run that throws, caught by the caller -> the stack cut back to the depth before the run, the same error thrown', () => {
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
				const { state, reporter, values } = makeRecordedReporter()
				openFrames({ reporter, count: framesBefore })
				const before = state.progress && { ...state.progress }
				const eventsBefore = values.length
				const thrown = new Error('boom')

				await expect(
					reporter.runInPlan({
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
				// its plan and step, each nested plan and step, then the frames cut in one event
				expect(values.length - eventsBefore).toBe(3 + 2 * framesLeftOpenInside)
				// the frames before the run still close as before: closing them all clears the bar
				closeFrames({ reporter, count: framesBefore })
				expect(state.progress).toBeNull()
			})
		}

		it('a top-level run that throws -> progress null, the clear flushed as terminal', async () => {
			const { state, reporter, terminals } = makeRecordedReporter()
			const thrown = new Error('boom')

			await expect(
				reporter.runInPlan({
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

		it('a run that throws synchronously -> rejected with that error, the stack cut back', async () => {
			const { state, reporter } = makeRecordedReporter()
			openFrames({ reporter, count: 1 })
			const before = state.progress && { ...state.progress }
			const thrown = new Error('sync boom')
			const run = (() => {
				throw thrown
			}) as () => Promise<void>

			await expect(reporter.runInPlan({ plan: OP_PLAN, run })).rejects.toBe(thrown)

			expect(state.progress).toEqual(before)
		})
	})

	it('a nested run that throws, caught inside the outer run, then the outer run steps -> its own plan advances and closes balanced', async () => {
		const byHand = makeRecordedReporter()
		byHand.reporter.plan({ steps: 3, label: 'phases' })
		byHand.reporter.nextStep('copy')
		byHand.reporter.plan({ steps: 2 })
		byHand.reporter.nextStep()
		byHand.reporter.endPlan()
		byHand.reporter.nextStep('wire')
		byHand.reporter.endPlan()

		const helped = makeRecordedReporter()
		const { reporter } = helped
		const thrown = new Error('copy refused')
		let caught: unknown
		const outer = reporter.runInPlan({
			plan: { steps: 3, label: 'phases' },
			run: async () => {
				reporter.nextStep('copy')
				try {
					await reporter.runInPlan({
						plan: { steps: 2 },
						run: async () => {
							reporter.nextStep()
							// a nested op of its own left its frame open when it threw
							reporter.plan({ steps: 5, label: 'deep' })
							throw thrown
						},
					})
				} catch (error) {
					caught = error
				}
				reporter.nextStep('wire')
			},
		})

		await expect(outer).resolves.toBeUndefined()
		expect(caught).toBe(thrown)
		// the deep frame and the nested run's frame go in one cut: the values without the deep frame's own events
		const withoutDeep = helped.values.filter((value) => value?.label !== 'deep')
		expect(withoutDeep).toEqual(byHand.values)
		expect(helped.state.progress).toBeNull()
		expect(helped.terminals.at(-1)).toBe(true)
	})

	describe('a run whose body succeeds unbalanced -> the stack back to the frames before the run, no caller frame popped', () => {
		it('a nested frame left open -> both cut in one event, the caller frame shown as before', async () => {
			const { state, reporter, values } = makeRecordedReporter()
			openFrames({ reporter, count: 1 })
			const before = state.progress && { ...state.progress }
			const eventsBefore = values.length

			await expect(
				reporter.runInPlan({
					plan: OP_PLAN,
					run: async () => {
						reporter.nextStep()
						reporter.plan({ steps: 2, label: 'left open' })
					},
				}),
			).resolves.toBeUndefined()

			expect(state.progress).toEqual(before)
			// plan, nextStep, the nested plan, then the one cut
			expect(values.length - eventsBefore).toBe(4)
			closeFrames({ reporter, count: 1 })
			expect(state.progress).toBeNull()
		})

		it('an extra endPlan() on its own frame -> the caller frame still open, nothing more signalled', async () => {
			const { state, reporter, values } = makeRecordedReporter()
			openFrames({ reporter, count: 1 })
			const before = state.progress && { ...state.progress }
			const eventsBefore = values.length

			await expect(
				reporter.runInPlan({
					plan: OP_PLAN,
					run: async () => {
						reporter.nextStep()
						reporter.endPlan()
					},
				}),
			).resolves.toBeUndefined()
			const eventsAfterRun = values.length

			// plan, nextStep, the body's endPlan: the run's end finds nothing to cut and signals nothing
			expect(eventsAfterRun - eventsBefore).toBe(3)
			expect(state.progress).toEqual(before)
			expect(values.at(-1)).toEqual(before)
			closeFrames({ reporter, count: 1 })
			expect(state.progress).toBeNull()
			expect(values.length).toBe(eventsAfterRun + 1)
		})
	})

	it('two runs at once under one frame (unsupported) -> the first to end cuts back to the caller frame in one event, the later end signals nothing', async () => {
		const { state, reporter, values } = makeRecordedReporter()
		openFrames({ reporter, count: 1 })
		const callerFrame = state.progress && { ...state.progress }
		let releaseFirst: () => void = () => {}
		const firstMayEnd = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		let releaseLater: () => void = () => {}
		const laterMayEnd = new Promise<void>((resolve) => {
			releaseLater = resolve
		})

		const first = reporter.runInPlan({ plan: OP_PLAN, run: () => firstMayEnd })
		const later = reporter.runInPlan({ plan: OP_PLAN, run: () => laterMayEnd })
		const eventsWhileBothRun = values.length
		releaseFirst()
		await expect(first).resolves.toBeUndefined()
		const eventsAfterFirst = values.length
		releaseLater()
		await expect(later).resolves.toBeUndefined()

		expect(eventsAfterFirst - eventsWhileBothRun).toBe(1)
		expect(values.at(-1)).toEqual(callerFrame)
		expect(values.length).toBe(eventsAfterFirst)
		expect(state.progress).toEqual(callerFrame)
	})

	it('the answer type is the type run answers', async () => {
		const { reporter } = makeRecordedReporter()
		const answer = reporter.runInPlan({ plan: OP_PLAN, run: async () => 7 })

		expectTypeOf(answer).toEqualTypeOf<Promise<number>>()
		await expect(answer).resolves.toBe(7)
	})

	describe('on the no-op reporter of a query', () => {
		it('a successful run -> its value, typed as run answers it', async () => {
			const answer = NOOP_PROGRESS_REPORTER.runInPlan({ plan: OP_PLAN, run: async () => 7 })

			expectTypeOf(answer).toEqualTypeOf<Promise<number>>()
			await expect(answer).resolves.toBe(7)
		})

		it('a run that throws -> the same error', async () => {
			const thrown = new Error('boom')
			await expect(
				NOOP_PROGRESS_REPORTER.runInPlan({
					plan: OP_PLAN,
					run: async () => {
						throw thrown
					},
				}),
			).rejects.toBe(thrown)
		})

		it('a run that throws synchronously -> rejected with that error, not thrown at the call', async () => {
			const thrown = new Error('sync boom')
			const run = (() => {
				throw thrown
			}) as () => Promise<void>
			let answer: Promise<void> | undefined

			expect(() => {
				answer = NOOP_PROGRESS_REPORTER.runInPlan({ plan: OP_PLAN, run })
			}).not.toThrow()
			await expect(answer).rejects.toBe(thrown)
		})
	})
})
