import { createPerf } from './create-perf'

import { afterEach, describe, expect, it } from 'vitest'

// Each test starts from a clean timeline so cross-test measures never leak.
afterEach(() => {
	performance.clearMarks()
	performance.clearMeasures()
})

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
