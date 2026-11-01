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
