import { tellListener, tellListeners } from './tell-listener'
import { quietReports } from './tell-listener.fixtures'

import { describe, expect, it, vi } from 'vitest'

const FAILURE = new Error('a listener failing')
const REPORT = '[dialecte] a listener of the case’s ticks threw; what told it goes on:'

describe('a listener told', () => {
	type ListenerCase = { listener: ((value: number) => unknown) | undefined; reported: unknown[][] }
	const listenerCases: Record<string, ListenerCase> = {
		'none → nothing told, nothing reported': { listener: undefined, reported: [] },
		'answering → nothing reported': {
			listener: function answering() {
				return 'heard'
			},
			reported: [],
		},
		'throwing → reported on the console with what it was told of; the caller not failed': {
			listener: function throwing() {
				throw FAILURE
			},
			reported: [[REPORT, FAILURE]],
		},
		'answering a promise that rejects → reported as one that throws': {
			listener: async function rejecting() {
				throw FAILURE
			},
			reported: [[REPORT, FAILURE]],
		},
	}
	for (const [description, { listener, reported }] of Object.entries(listenerCases)) {
		it(description, async () => {
			const reports = quietReports()
			tellListener({ listener, value: 1, of: 'the case’s ticks' })
			await vi.waitFor(function reportedAsMeant() {
				expect(reports.mock.calls).toEqual(reported)
			})
		})
	}
})

describe('a listener failing at every tell', () => {
	type OnceCase = {
		/** The call each tell belongs to (a progress listener's import, export or commit), by index; none: no call named. */
		calls: (number | undefined)[]
		/** The failures reported, by the tell's index. */
		reported: number[]
	}
	const onceCases: Record<string, OnceCase> = {
		'its ticks of one call → told every time, reported once (the first)': {
			calls: [0, 0, 0],
			reported: [0],
		},
		'its ticks of two calls (one listener reused) → reported once per call': {
			calls: [0, 0, 1, 1],
			reported: [0, 2],
		},
		'no call named (a store’s subscriber) → every failure reported': {
			calls: [undefined, undefined],
			reported: [0, 1],
		},
	}
	for (const [description, { calls, reported }] of Object.entries(onceCases)) {
		it(description, () => {
			const reports = quietReports()
			const told: number[] = []
			const failures = calls.map(function failureOf(_call, index) {
				return new Error(`tick ${index}`)
			})
			const callObjects = [{}, {}]
			function failingEachTime(value: number): void {
				told.push(value)
				throw failures[value]
			}
			for (const [value, call] of calls.entries()) {
				tellListener({
					listener: failingEachTime,
					value,
					of: 'the case’s ticks',
					...(call !== undefined && { call: callObjects[call] }),
				})
			}
			expect(told).toEqual(calls.map((_call, index) => index))
			expect(reports.mock.calls).toEqual(
				reported.map(function reportOf(index) {
					return [REPORT, failures[index]]
				}),
			)
		})
	}
})

describe('listeners told one value', () => {
	it('one throwing → the others told all the same, in order, its failure reported once', () => {
		const reports = quietReports()
		const heard: string[] = []
		const listeners = new Set<(value: number) => void>([
			function first(value) {
				heard.push(`first ${value}`)
			},
			function failing() {
				throw FAILURE
			},
			function last(value) {
				heard.push(`last ${value}`)
			},
		])
		tellListeners({ listeners, value: 2, of: 'the case’s ticks' })
		expect(heard).toEqual(['first 2', 'last 2'])
		expect(reports.mock.calls).toEqual([[REPORT, FAILURE]])
	})

	it('a listener removed by another as it is told → the set told as it stood when told', () => {
		const heard: string[] = []
		const listeners = new Set<(value: number) => void>()
		function removesTheNext(): void {
			heard.push('first')
			listeners.delete(removed)
		}
		function removed(): void {
			heard.push('removed')
		}
		listeners.add(removesTheNext)
		listeners.add(removed)
		tellListeners({ listeners, value: 3, of: 'the case’s ticks' })
		expect(heard).toEqual(['first', 'removed'])
	})
})
