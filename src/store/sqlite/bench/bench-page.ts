import { QUIET_SLICE_MS } from './bench.constants'

import { commands } from 'vitest/browser'

import type { BenchFixture } from './bench.types'

/**
 * Wait for a 1-minute load below `maxLoad`, one short command at a time (a browser command that
 * outlives vitest's RPC timeout closes the browser connection), at most `maxWaitMs`.
 */
export async function waitForQuietMachine(params: {
	maxLoad: number
	maxWaitMs: number
}): Promise<{ waitedMs: number; load: number[] }> {
	const { maxLoad, maxWaitMs } = params
	const startedAt = performance.now()
	for (;;) {
		const { load } = await commands.benchWaitForQuiet({ maxLoad, maxWaitMs: QUIET_SLICE_MS })
		const waitedMs = performance.now() - startedAt
		if (load[0]! < maxLoad || waitedMs > maxWaitMs) return { waitedMs, load }
	}
}

/** A fixture the server serves, fetched as a `File` named `.xml` (what the verbatim config imports). */
export async function fetchFixtureFile(params: { fixture: BenchFixture }): Promise<File> {
	const { fixture } = params
	const response = await fetch(fixture.url)
	if (!response.ok) throw new Error(`fixture ${fixture.name} not served (${response.status})`)
	return new File([await response.blob()], `${fixture.name}.xml`, { type: 'text/xml' })
}
