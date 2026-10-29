import type { CommitDuringImport, CommitWaits, HistoryImport } from './bench.types'

/** The commits sent during the import, each against the import's index builds (a phase `indexing` until the next change). */
export function commitWaitsOf(params: {
	sent: { sentAt: number; resolvedAt: number }[]
	imported: HistoryImport
}): CommitWaits {
	const { sent, imported } = params
	const { phases, startedAtEpochMs, endedAtEpochMs } = imported
	const indexing = phases.flatMap(({ atEpochMs, phase }, index) =>
		phase === 'indexing'
			? [{ from: atEpochMs, to: phases[index + 1]?.atEpochMs ?? endedAtEpochMs }]
			: [],
	)
	const all: CommitDuringImport[] = sent
		.filter(({ sentAt }) => sentAt <= endedAtEpochMs)
		.map(({ sentAt, resolvedAt }) => ({
			sentMs: sentAt - startedAtEpochMs,
			waitMs: resolvedAt - sentAt,
			duringIndexing: indexing.some(({ from, to }) => from < resolvedAt && to > sentAt),
		}))
	const outside = all.filter((commit) => !commit.duringIndexing).map((commit) => commit.waitMs)
	const during = all.filter((commit) => commit.duringIndexing).map((commit) => commit.waitMs)
	return {
		commits: all.length,
		outsideIndexing: {
			count: outside.length,
			p50Ms: medianOf({ values: outside }),
			maxMs: Math.max(0, ...outside),
		},
		duringIndexing: { count: during.length, maxMs: Math.max(0, ...during) },
		all,
	}
}

function medianOf(params: { values: number[] }): number {
	const sorted = [...params.values].sort((left, right) => left - right)
	if (sorted.length === 0) return 0
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** The time on the clock every realm of the page shares. */
export function epochNow(): number {
	return performance.timeOrigin + performance.now()
}
