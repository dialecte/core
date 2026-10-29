import { createPerf } from './create-perf'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/** The timeline is the realm's: what a test before (of this file or another sharing the realm) measured is cleared. */
function clearTimeline(): void {
	performance.clearMarks()
	performance.clearMeasures()
}

// Each test starts from a clean timeline and leaves one, so measures never leak across tests or files.
beforeEach(clearTimeline)
afterEach(clearTimeline)

describe('createPerf (enabled)', () => {
	it('start()/stop() records a measure; report() sums it by the UNQUALIFIED name', () => {
		const perf = createPerf({ enabled: true })

		perf.start('scl::importTypes')
		perf.stop('scl::importTypes')

		const report = perf.report()
		expect(Object.keys(report)).toEqual(['scl::importTypes']) // dialecte:: root stripped
		expect(report['scl::importTypes'].calls).toBe(1)
		expect(report['scl::importTypes'].totalMs).toBeGreaterThanOrEqual(0)
		expect(report['scl::importTypes'].avgMs).toBe(report['scl::importTypes'].totalMs)
	})

	it('report() is synchronous — stop(); report() in the SAME tick sees the result (no PerformanceObserver lag)', () => {
		const perf = createPerf({ enabled: true })

		perf.start('core::commit')
		perf.stop('core::commit')

		expect(perf.report()['core::commit'].calls).toBe(1) // no await/tick needed
	})

	it('aggregates repeated spans of the same name: calls counts up, avg = total / calls', () => {
		const perf = createPerf({ enabled: true })

		perf.start('core::commit')
		perf.stop('core::commit')
		perf.start('core::commit')
		perf.stop('core::commit')

		const entry = perf.report()['core::commit']
		expect(entry.calls).toBe(2)
		expect(entry.avgMs).toBeCloseTo(entry.totalMs / 2, 10)
	})

	it('per-name stack supports nested/re-entrant same-name spans (start, start, stop, stop)', () => {
		const perf = createPerf({ enabled: true })

		perf.start('scl::deepClone')
		perf.start('scl::deepClone') // re-entrant
		perf.stop('scl::deepClone')
		perf.stop('scl::deepClone')

		expect(perf.report()['scl::deepClone'].calls).toBe(2)
	})

	it('stop() without a matching start() is a safe no-op (no throw, no measure)', () => {
		const perf = createPerf({ enabled: true })

		expect(() => perf.stop('core::orphan')).not.toThrow()
		expect(perf.report()).toEqual({})
	})

	it('report() excludes any measure placed outside the dialecte:: root prefix', () => {
		const perf = createPerf({ enabled: true })

		performance.mark('foreign-start')
		performance.measure('some-other-lib::op', 'foreign-start')
		perf.start('scl::importTypes')
		perf.stop('scl::importTypes')

		expect(Object.keys(perf.report())).toEqual(['scl::importTypes'])
	})

	it('reset() clears marks and measures so report() returns {} afterwards', () => {
		const perf = createPerf({ enabled: true })

		perf.start('core::commit')
		perf.stop('core::commit')
		perf.reset()

		expect(perf.report()).toEqual({})
		expect(performance.getEntriesByType('measure')).toHaveLength(0)
	})
})

describe('createPerf (disabled)', () => {
	it('every method is a no-op and report() is empty even after start/stop', () => {
		const perf = createPerf({ enabled: false })

		perf.start('scl::importTypes')
		perf.stop('scl::importTypes')

		expect(perf.report()).toEqual({})
		expect(performance.getEntriesByType('measure')).toHaveLength(0) // nothing written
	})
})

describe('createPerf — counters', () => {
	it('count() tallies by the UNQUALIFIED name; report() surfaces it as `count`', () => {
		const perf = createPerf({ enabled: true })

		perf.count('core::store::get')
		perf.count('core::store::get')
		perf.count('core::store::getByTagName')

		const report = perf.report()
		expect(report['core::store::get'].count).toBe(2)
		expect(report['core::store::getByTagName'].count).toBe(1)
	})

	it('a counted-only name reports zeroed timing fields alongside the count', () => {
		const perf = createPerf({ enabled: true })

		perf.count('core::store::get')

		expect(perf.report()['core::store::get']).toMatchObject({ calls: 0, totalMs: 0, count: 1 })
	})

	it('a name that is both timed and counted merges into one entry', () => {
		const perf = createPerf({ enabled: true })

		perf.start('core::commit')
		perf.stop('core::commit')
		perf.count('core::commit')

		const entry = perf.report()['core::commit']
		expect(entry.calls).toBe(1)
		expect(entry.count).toBe(1)
	})

	it('reset() clears counters too', () => {
		const perf = createPerf({ enabled: true })

		perf.count('core::store::get')
		perf.reset()

		expect(perf.report()).toEqual({})
	})

	it('disabled: count() is a no-op', () => {
		const perf = createPerf({ enabled: false })

		perf.count('core::store::get')

		expect(perf.report()).toEqual({})
	})
})

describe('createPerf — time() accumulator', () => {
	it('accumulates wall-time as calls/totalMs WITHOUT emitting a per-call timeline measure', () => {
		const perf = createPerf({ enabled: true })

		perf.time('core::import::onOpenTag', () => {})

		const entry = perf.report()['core::import::onOpenTag']
		expect(entry.calls).toBe(1)
		expect(entry.totalMs).toBeGreaterThanOrEqual(0)
		// no timeline pollution — the whole point vs start/stop for a hot per-node path
		expect(performance.getEntriesByType('measure')).toHaveLength(0)
	})

	it('aggregates repeated calls of the same name: calls counts up, avg = total / calls', () => {
		const perf = createPerf({ enabled: true })

		perf.time('core::import::onCloseTag', () => {})
		perf.time('core::import::onCloseTag', () => {})

		const entry = perf.report()['core::import::onCloseTag']
		expect(entry.calls).toBe(2)
		expect(entry.avgMs).toBeCloseTo(entry.totalMs / 2, 10)
	})

	it('returns the wrapped function result', () => {
		const perf = createPerf({ enabled: true })

		expect(perf.time('core::import::onText', () => 42)).toBe(42)
	})

	it('reset() clears time accumulators', () => {
		const perf = createPerf({ enabled: true })

		perf.time('core::import::onOpenTag', () => {})
		perf.reset()

		expect(perf.report()).toEqual({})
	})

	it('disabled: time() still runs fn and returns its result but records nothing', () => {
		const perf = createPerf({ enabled: false })

		expect(perf.time('core::import::onOpenTag', () => 7)).toBe(7)
		expect(perf.report()).toEqual({})
	})
})

describe('createPerf — handing timings to another realm', () => {
	it('snapshot() holds this perf’s spans on its own clock, its tallies and its timeOrigin', () => {
		const perf = createPerf({ enabled: true })

		perf.start('import::insert')
		perf.stop('import::insert')
		perf.time('import::parse', () => {})
		perf.count('import::batch')

		const snapshot = perf.snapshot()
		expect(snapshot.timeOrigin).toBe(performance.timeOrigin)
		expect(snapshot.spans).toEqual([
			{ name: 'import::insert', startTime: expect.any(Number), duration: expect.any(Number) },
		])
		expect(snapshot.totals).toEqual({
			'import::parse': { calls: 1, totalMs: expect.any(Number), avgMs: expect.any(Number) },
			'import::batch': { calls: 0, totalMs: 0, avgMs: 0, count: 1 },
		})
	})

	it('timeline: false keeps the spans off the shared timeline, in report() and snapshot() only', () => {
		const perf = createPerf({ enabled: true, timeline: false })

		perf.start('import::insert')
		perf.stop('import::insert')

		expect(performance.getEntriesByType('measure')).toHaveLength(0)
		expect(perf.report()['import::insert'].calls).toBe(1)
		expect(perf.snapshot().spans.map((span) => span.name)).toEqual(['import::insert'])
	})

	type MergeCase = {
		/** how much later the other realm started than this one, in ms */
		originShift: number
		span: { startTime: number; duration: number }
		expectedStartTime: number
	}
	const mergeCases: Record<string, MergeCase> = {
		'a realm started 1000 ms later → its span lands 1000 ms later here': {
			originShift: 1000,
			span: { startTime: 50, duration: 20 },
			expectedStartTime: 1050,
		},
		'a realm started earlier than this one → its span lands at 0, never before': {
			originShift: -1000,
			span: { startTime: 50, duration: 20 },
			expectedStartTime: 0,
		},
		'the same realm → its span lands where it was': {
			originShift: 0,
			span: { startTime: 50, duration: 20 },
			expectedStartTime: 50,
		},
	}
	for (const [description, testCase] of Object.entries(mergeCases)) {
		it(`merge() places spans on this timeline: ${description}`, () => {
			const perf = createPerf({ enabled: true })

			perf.merge({
				report: {
					timeOrigin: performance.timeOrigin + testCase.originShift,
					spans: [{ name: 'import::insert', ...testCase.span }],
					totals: {},
				},
				prefix: 'store',
			})

			const [measure] = performance.getEntriesByName('dialecte::store::import::insert', 'measure')
			expect(measure.startTime).toBeCloseTo(testCase.expectedStartTime, 3)
			expect(measure.duration).toBeCloseTo(testCase.span.duration, 3)
			expect(perf.report()['store::import::insert']).toMatchObject({ calls: 1 })
		})
	}

	it('merge() adds the tallies under the prefix to this perf’s own', () => {
		const perf = createPerf({ enabled: true })
		perf.time('store::import::parse', () => {})

		perf.merge({
			report: {
				timeOrigin: performance.timeOrigin,
				spans: [],
				totals: {
					'import::parse': { calls: 3, totalMs: 30, avgMs: 10 },
					'import::batch': { calls: 0, totalMs: 0, avgMs: 0, count: 4 },
				},
			},
			prefix: 'store',
		})

		const report = perf.report()
		expect(report['store::import::parse'].calls).toBe(4)
		expect(report['store::import::parse'].totalMs).toBeGreaterThanOrEqual(30)
		expect(report['store::import::batch']).toMatchObject({ calls: 0, count: 4 })
	})

	it('disabled: snapshot() is empty and merge() records nothing', () => {
		const perf = createPerf({ enabled: false })

		perf.merge({
			report: {
				timeOrigin: performance.timeOrigin,
				spans: [{ name: 'import::insert', startTime: 1, duration: 1 }],
				totals: {},
			},
			prefix: 'store',
		})

		expect(perf.snapshot()).toEqual({ timeOrigin: performance.timeOrigin, spans: [], totals: {} })
		expect(performance.getEntriesByType('measure')).toHaveLength(0)
	})
})
