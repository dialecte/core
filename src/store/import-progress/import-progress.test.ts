import { createImportReporter } from './import-progress'

import { describe, expect, it } from 'vitest'

import { createPerf } from '@/perf'

import type { ImportProgressReport } from './import-progress.types'
import type { Perf } from '@/perf'
import type { ImportProgress } from '@/store/store.types'

// One file's reporter on a clock the case moves: what the listener is told, and when a report waits.

const TOTAL_BYTES = 100
const INTERVAL_MS = 50

/** A report the case tells, at a time on the case's clock. */
type Told = { at: number; report: ImportProgressReport }

type TestCase = {
	told: Told[]
	expected: ImportProgress[]
}

const bytes = { bytesRead: TOTAL_BYTES, totalBytes: TOTAL_BYTES }

const testCases: Record<string, TestCase> = {
	'storing reports → each told at once with its bytes, out of the file size': {
		told: [
			{ at: 0, report: { phase: 'storing', bytesRead: 40 } },
			{ at: 1, report: { phase: 'storing', bytesRead: 100 } },
		],
		expected: [
			{ phase: 'storing', bytesRead: 40, totalBytes: TOTAL_BYTES },
			{ phase: 'storing', bytesRead: 100, totalBytes: TOTAL_BYTES },
		],
	},
	'a phase after storing → told at once with the bytes read last': {
		told: [
			{ at: 0, report: { phase: 'storing', bytesRead: 60 } },
			{ at: 1, report: { phase: 'processing', step: 'start' } },
		],
		expected: [
			{ phase: 'storing', bytesRead: 60, totalBytes: TOTAL_BYTES },
			{ phase: 'processing', step: 'start', bytesRead: 60, totalBytes: TOTAL_BYTES },
		],
	},
	'counted reports of one step within the interval → the first told, the ones between dropped, the last of the step told':
		{
			told: [
				{ at: 0, report: { phase: 'storing', bytesRead: 100 } },
				{ at: 1, report: { phase: 'processing', step: 'links', done: 1, total: 4 } },
				{ at: 2, report: { phase: 'processing', step: 'links', done: 2, total: 4 } },
				{ at: 3, report: { phase: 'processing', step: 'links', done: 3, total: 4 } },
				{ at: 4, report: { phase: 'processing', step: 'links', done: 4, total: 4 } },
			],
			expected: [
				{ phase: 'storing', ...bytes },
				{ phase: 'processing', step: 'links', done: 1, total: 4, ...bytes },
				{ phase: 'processing', step: 'links', done: 4, total: 4, ...bytes },
			],
		},
	'a counted report once the interval ran since the last one told → told': {
		told: [
			{ at: 0, report: { phase: 'storing', bytesRead: 100 } },
			{ at: 10, report: { phase: 'checking', done: 0, total: 3 } },
			{ at: 20, report: { phase: 'checking', done: 1, total: 3 } },
			{ at: 10 + INTERVAL_MS, report: { phase: 'checking', done: 2, total: 3 } },
		],
		expected: [
			{ phase: 'storing', ...bytes },
			{ phase: 'checking', done: 0, total: 3, ...bytes },
			{ phase: 'checking', done: 2, total: 3, ...bytes },
		],
	},
	'a step left before its count is done → its last report held told before the next step': {
		told: [
			{ at: 0, report: { phase: 'storing', bytesRead: 100 } },
			{ at: 1, report: { phase: 'processing', step: 'links', done: 1, total: 9 } },
			{ at: 2, report: { phase: 'processing', step: 'links', done: 5, total: 9 } },
			{ at: 3, report: { phase: 'processing', step: 'names' } },
		],
		expected: [
			{ phase: 'storing', ...bytes },
			{ phase: 'processing', step: 'links', done: 1, total: 9, ...bytes },
			{ phase: 'processing', step: 'links', done: 5, total: 9, ...bytes },
			{ phase: 'processing', step: 'names', ...bytes },
		],
	},
	'a phase left with a report held → the held one told before the next phase': {
		told: [
			{ at: 0, report: { phase: 'storing', bytesRead: 100 } },
			{ at: 1, report: { phase: 'applying', done: 0, total: 8 } },
			{ at: 2, report: { phase: 'applying', done: 3, total: 8 } },
			{ at: 3, report: { phase: 'finishing' } },
		],
		expected: [
			{ phase: 'storing', ...bytes },
			{ phase: 'applying', done: 0, total: 8, ...bytes },
			{ phase: 'applying', done: 3, total: 8, ...bytes },
			{ phase: 'finishing', ...bytes },
		],
	},
	'the same report twice → told once': {
		told: [
			{ at: 0, report: { phase: 'storing', bytesRead: 100 } },
			{ at: 1, report: { phase: 'applying', done: 8, total: 8 } },
			{ at: 2, report: { phase: 'applying', done: 8, total: 8 } },
		],
		expected: [
			{ phase: 'storing', ...bytes },
			{ phase: 'applying', done: 8, total: 8, ...bytes },
		],
	},
	'an index built → told at once with its name': {
		told: [
			{ at: 0, report: { phase: 'storing', bytesRead: 100 } },
			{ at: 1, report: { phase: 'indexing', index: 'id' } },
		],
		expected: [
			{ phase: 'storing', ...bytes },
			{ phase: 'indexing', index: 'id', ...bytes },
		],
	},
}

/**
 * What the listener is told when the reports are told, each at its time; closed after the last when `close`, then
 * the reports `afterClose` told.
 */
function heardOf(params: {
	told: Told[]
	close?: boolean
	afterClose?: ImportProgressReport[]
	perf?: Perf
}): ImportProgress[] {
	const { told, close = false, afterClose = [], perf } = params
	const heard: ImportProgress[] = []
	let clock = 0
	const reporter = createImportReporter({
		totalBytes: TOTAL_BYTES,
		listener: (progress) => heard.push(progress),
		perf,
		intervalMs: INTERVAL_MS,
		now: () => clock,
	})
	for (const { at, report } of told) {
		clock = at
		reporter.tell(report)
	}
	if (close) reporter.close()
	for (const report of afterClose) reporter.tell(report)
	return heard
}

describe('createImportReporter - what the listener is told', () => {
	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, () => {
			expect(heardOf({ told: testCase.told })).toEqual(testCase.expected)
		})
	}
})

describe('createImportReporter - a report held with no report after it', () => {
	/** What the listener is told, the scheduled flushes run when `runScheduled`, after a close when `close`. */
	function heardWithSchedule(params: { runScheduled: boolean; close: boolean }): ImportProgress[] {
		const heard: ImportProgress[] = []
		const scheduled: { work: () => void; afterMs: number; cancelled: boolean }[] = []
		const reporter = createImportReporter({
			totalBytes: TOTAL_BYTES,
			listener: (progress) => heard.push(progress),
			intervalMs: INTERVAL_MS,
			now: () => 10,
			schedule: function scheduleOnCaseClock({ work, afterMs }) {
				const entry = { work, afterMs, cancelled: false }
				scheduled.push(entry)
				return function cancel() {
					entry.cancelled = true
				}
			},
		})
		reporter.tell({ phase: 'checking', done: 0, total: 4 })
		reporter.tell({ phase: 'checking', done: 1, total: 4 })
		if (params.close) reporter.close()
		if (params.runScheduled) {
			for (const entry of scheduled)
				if (!entry.cancelled && entry.afterMs <= INTERVAL_MS) entry.work()
		}
		return heard
	}

	type TestCase = { runScheduled: boolean; close: boolean; expected: ImportProgress[] }
	const bytesNone = { bytesRead: 0, totalBytes: TOTAL_BYTES }
	const testCases: Record<string, TestCase> = {
		'the interval runs out with no new report → the held report told': {
			runScheduled: true,
			close: false,
			expected: [
				{ phase: 'checking', done: 0, total: 4, ...bytesNone },
				{ phase: 'checking', done: 1, total: 4, ...bytesNone },
			],
		},
		'closed before the interval runs out → the held report never told': {
			runScheduled: true,
			close: true,
			expected: [{ phase: 'checking', done: 0, total: 4, ...bytesNone }],
		},
	}
	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, () => {
			expect(heardWithSchedule(testCase)).toEqual(testCase.expected)
		})
	}
})

describe('createImportReporter - closed', () => {
	it('a report held, then closed → the held one never told; a report after close → not told', () => {
		expect(
			heardOf({
				told: [
					{ at: 0, report: { phase: 'checking', done: 0, total: 4 } },
					{ at: 1, report: { phase: 'checking', done: 1, total: 4 } },
				],
				close: true,
				afterClose: [{ phase: 'finishing' }],
			}),
		).toEqual([{ phase: 'checking', done: 0, total: 4, bytesRead: 0, totalBytes: TOTAL_BYTES }])
	})

	it('perf on → each phase a span import::phase.<name>, each step of the hook a span import::hook.<step>, all closed', () => {
		const perf = createPerf({ enabled: true, timeline: false })
		const told: ImportProgressReport[] = [
			{ phase: 'storing', bytesRead: 100 },
			{ phase: 'processing', step: 'start' },
			{ phase: 'processing', step: 'links', done: 1, total: 2 },
			{ phase: 'processing', step: 'names' },
			{ phase: 'checking', done: 0, total: 0 },
			{ phase: 'finishing' },
		]
		expect(
			heardOf({ told: told.map((report, at) => ({ at, report })), close: true, perf }).length,
		).toBe(told.length)
		expect(
			perf
				.snapshot()
				.spans.map((span) => span.name)
				.sort(),
		).toEqual(
			[
				'import::phase.storing',
				'import::phase.processing',
				'import::hook.links',
				'import::hook.names',
				'import::phase.checking',
				'import::phase.finishing',
			].sort(),
		)
	})
})
