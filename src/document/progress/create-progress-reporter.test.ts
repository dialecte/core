import { createProgressReporter } from './create-progress-reporter'

import { describe, expect, it } from 'vitest'

import type { DocumentState } from '@/document/types'

function makeState(): DocumentState {
	return { loading: false, error: null, progress: null, history: [], lastUpdate: null }
}

describe('createProgressReporter — plan / nextStep / endPlan', () => {
	it('plan() pushes a frame surfaced as the bar; nextStep() is close-previous (current = completed steps)', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.plan({ steps: 5, label: 'Applying…' })
		expect(state.progress).toEqual({ current: 0, total: 5, label: 'Applying…', step: null })

		reporter.nextStep('Integrating A') // first step — nothing to close
		expect(state.progress?.current).toBe(0)
		expect(state.progress?.label).toBe('Integrating A')

		reporter.nextStep('Retiring') // closes step 1
		expect(state.progress?.current).toBe(1)
		expect(state.progress?.label).toBe('Retiring')

		reporter.nextStep('Binding')
		reporter.nextStep('Importing')
		reporter.nextStep('Attaching')
		expect(state.progress?.current).toBe(4) // 5 begun → 4 completed while the last runs
	})

	it('nextStep() without a label advances but keeps the current caption', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.plan({ steps: 3, label: 'Cloning' })
		reporter.nextStep()
		reporter.nextStep()
		expect(state.progress?.current).toBe(1)
		expect(state.progress?.label).toBe('Cloning')
	})

	it('plan() without a label yields an empty caption', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.plan({ steps: 2 })
		expect(state.progress).toEqual({ current: 0, total: 2, label: '', step: null })
	})

	it('endPlan() on the only frame clears progress', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.plan({ steps: 1, label: 'Applying…' })
		reporter.endPlan()
		expect(state.progress).toBeNull()
	})

	it('nextStep() is a no-op when no plan is open', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.nextStep('orphan')
		expect(state.progress).toBeNull()
	})

	it('an extra endPlan() on an empty stack is a safe no-op', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		expect(() => reporter.endPlan()).not.toThrow()
		expect(state.progress).toBeNull()
	})

	it('resets step state per operation: after endPlan a fresh plan()+nextStep does not advance', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.plan({ steps: 2, label: 'A' })
		reporter.nextStep('a1')
		reporter.nextStep('a2')
		expect(state.progress?.current).toBe(1)
		reporter.endPlan()

		reporter.plan({ steps: 3, label: 'B' })
		reporter.nextStep('b1') // first step of the NEW operation — must not advance
		expect(state.progress?.current).toBe(0)
		expect(state.progress?.label).toBe('b1')
	})
})

describe('createProgressReporter — nested plans (composable, no clobber)', () => {
	it('main bar stays stack[0]; the deepest plan surfaces as `step`; parent resurfaces on endPlan', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.plan({ steps: 2, label: 'Applying…' }) // main
		reporter.nextStep('Integrating A')
		expect(state.progress).toEqual({ current: 0, total: 2, label: 'Integrating A', step: null })

		reporter.plan({ steps: 8 }) // nested op (e.g. deepClone) — no label, inherits caption
		expect(state.progress).toEqual({
			current: 0,
			total: 2,
			label: 'Integrating A', // deepest has no label → falls back to main caption
			step: { current: 0, total: 8 },
		})

		reporter.nextStep()
		reporter.nextStep()
		reporter.nextStep()
		expect(state.progress?.step).toEqual({ current: 2, total: 8 })
		expect(state.progress?.current).toBe(0) // main untouched by the child's steps

		reporter.endPlan() // pop child — main resurfaces, step gone
		expect(state.progress).toEqual({ current: 0, total: 2, label: 'Integrating A', step: null })

		reporter.nextStep('Saving') // main keeps advancing on its own frame
		expect(state.progress?.current).toBe(1)
	})

	it('a nested plan with a label surfaces that label as the caption', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.plan({ steps: 2, label: 'Applying…' })
		reporter.nextStep('Integrating A')
		reporter.plan({ steps: 4, label: 'Committing' })
		expect(state.progress?.label).toBe('Committing')
		expect(state.progress?.step).toEqual({ current: 0, total: 4 })
	})

	it('a child plan/nextStep/endPlan never mutates the parent frame value', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.plan({ steps: 10, label: 'A' }) // parent (as its own main)
		reporter.nextStep()
		reporter.nextStep()
		reporter.nextStep()
		reporter.nextStep()
		reporter.nextStep() // current = 4
		reporter.plan({ steps: 3 }) // child
		reporter.nextStep()
		reporter.nextStep()
		reporter.endPlan() // pop child

		expect(state.progress?.current).toBe(4) // parent intact
		expect(state.progress?.step).toBeNull()
	})

	it('no-main case: a lone plan() becomes the main itself (step stays null)', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.plan({ steps: 50, label: 'Committing' })
		expect(state.progress).toEqual({ current: 0, total: 50, label: 'Committing', step: null })

		reporter.nextStep()
		reporter.nextStep()
		expect(state.progress?.current).toBe(1)
		expect(state.progress?.step).toBeNull()

		reporter.endPlan()
		expect(state.progress).toBeNull()
	})

	it('forceClear() empties the whole plan stack; a fresh plan starts clean', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		reporter.plan({ steps: 5, label: 'Outer' })
		reporter.plan({ steps: 8 })
		reporter.forceClear()
		expect(state.progress).toBeNull()

		reporter.plan({ steps: 7, label: 'Fresh' })
		expect(state.progress).toEqual({ current: 0, total: 7, label: 'Fresh', step: null })
	})
})

describe('createProgressReporter — signalStateChange bridge', () => {
	it('fires signalStateChange(false) on every non-terminal mutation', () => {
		const state = makeState()
		const calls: boolean[] = []
		const reporter = createProgressReporter(state, (terminal) => calls.push(terminal))

		reporter.plan({ steps: 2, label: 'Applying…' })
		reporter.nextStep('Step')
		reporter.plan({ steps: 3 })
		reporter.nextStep()
		reporter.endPlan() // pop child — stack not empty, non-terminal

		expect(calls).toEqual([false, false, false, false, false])
	})

	it('fires signalStateChange(true) — a terminal frame — on endPlan() that empties the stack and on forceClear()', () => {
		const state = makeState()
		const calls: boolean[] = []
		const reporter = createProgressReporter(state, (terminal) => calls.push(terminal))

		reporter.plan({ steps: 1, label: 'A' }) // non-terminal
		reporter.endPlan() // stack empty → terminal
		reporter.forceClear() // always terminal

		expect(calls).toEqual([false, true, true])
	})

	it('a nested endPlan() that does NOT empty the stack is non-terminal', () => {
		const state = makeState()
		const calls: boolean[] = []
		const reporter = createProgressReporter(state, (terminal) => calls.push(terminal))

		reporter.plan({ steps: 5, label: 'Outer' })
		reporter.plan({ steps: 9 })
		calls.length = 0 // ignore the two plan() emissions
		reporter.endPlan() // depth 2 -> 1: still active, non-terminal
		reporter.endPlan() // depth 1 -> 0: terminal

		expect(calls).toEqual([false, true])
	})

	it('an unbalanced endPlan() on an empty stack does not fire signalStateChange', () => {
		const state = makeState()
		const calls: boolean[] = []
		const reporter = createProgressReporter(state, (terminal) => calls.push(terminal))

		reporter.endPlan()

		expect(calls).toEqual([])
	})

	it('works without a signalStateChange argument (defaults to a no-op — Query/standalone use)', () => {
		const state = makeState()
		const reporter = createProgressReporter(state)

		expect(() => {
			reporter.plan({ steps: 1, label: 'A' })
			reporter.nextStep()
			reporter.forceClear()
		}).not.toThrow()
	})
})
