import { describeCommitChanges } from './describe-commit-changes'

import { describe, expect, it } from 'vitest'

import { COMMIT_CHANGES_MAX } from '@/project/project.constants'

import type { PlacedRecord, ProjectChannelMessage } from '@/project/types'

/** A commit message at the cap stays well under this many bytes as JSON. */
const MESSAGE_AT_CAP_BUDGET_BYTES = 1024 * 1024

/** Runs of the builder and of a structured clone; the bench takes their median. */
const SIZE_BENCH_RUNS = 21

// The size of the commit message a 5,000-record commit posts (4,999 records created under one parent, that parent
// updated: the cap exactly), as JSON bytes, and the time to build its changes and to clone it as a BroadcastChannel
// does; then the same commit one record larger, whose changes are unknown. Runs under `--mode bench` (or
// VITE_BENCH=1): `npm run test:perf:node`.
const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'

function median(values: number[]): number {
	const sorted = [...values].sort((left, right) => left - right)
	return sorted[Math.floor(sorted.length / 2)]!
}

function timed(run: () => unknown): number {
	const durations: number[] = []
	for (let index = 0; index < SIZE_BENCH_RUNS; index++) {
		const startedAt = performance.now()
		run()
		durations.push(performance.now() - startedAt)
	}
	return median(durations)
}

/** `created` records under one parent, that parent updated: ids shaped as the ids a project makes. */
function commitOf(params: { created: number }) {
	const parent: PlacedRecord = {
		id: crypto.randomUUID(),
		tagName: 'AA_1',
		parent: { id: crypto.randomUUID() },
	}
	const creates = Array.from({ length: params.created }, function created(): PlacedRecord {
		return { id: crypto.randomUUID(), tagName: 'AAA_1', parent: { id: parent.id } }
	})
	return { creates, updates: [parent], deletes: [] }
}

function messageOf(params: { created: number }): {
	message: ProjectChannelMessage
	bytes: number
	buildMs: number
} {
	const writes = commitOf(params)
	const buildMs = timed(() => describeCommitChanges(writes))
	const message: ProjectChannelMessage = {
		type: 'commit',
		documentId: crypto.randomUUID(),
		timestamp: Date.now(),
		changes: describeCommitChanges(writes),
	}
	return { message, bytes: new TextEncoder().encode(JSON.stringify(message)).length, buildMs }
}

describe.skipIf(!RUN)('the commit message of a 5,000-record commit', () => {
	it('at the cap -> every ref told, under the budget; one record past it -> { unknown: true }, a few bytes', () => {
		const atCap = messageOf({ created: COMMIT_CHANGES_MAX - 1 })
		const cloneMs = timed(() => structuredClone(atCap.message))
		const pastCap = messageOf({ created: COMMIT_CHANGES_MAX })

		console.info(
			`[commit-changes-size] at the cap (${COMMIT_CHANGES_MAX} refs): ${atCap.bytes} bytes as JSON, ` +
				`built in ${atCap.buildMs.toFixed(3)} ms, cloned in ${cloneMs.toFixed(3)} ms (medians of ${SIZE_BENCH_RUNS}); ` +
				`one past it: ${pastCap.bytes} bytes`,
		)
		expect(atCap.message).toMatchObject({ changes: { updated: [expect.anything()] } })
		expect(atCap.bytes).toBeLessThan(MESSAGE_AT_CAP_BUDGET_BYTES)
		expect(pastCap.message).toMatchObject({ changes: { unknown: true } })
		expect(pastCap.bytes).toBeLessThan(256)
	})
})
