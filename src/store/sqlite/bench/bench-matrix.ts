/** One cell of the bench matrix, its id `<fixture>-r<write-back ratio>-<variant>[-fail<n>][-<suffix>]`. */
import { RUNS_PER_CELL } from './bench.constants'

import type { BenchCell } from './bench.types'

export function cell(
	params: Omit<BenchCell, 'id' | 'runs'> & { runs?: number; suffix?: string },
): BenchCell {
	const { variant, fixture, afterImportRatio, failAtShare, suffix, ...rest } = params
	const failure = failAtShare === undefined ? '' : `-fail${failAtShare * 100}`
	return {
		runs: RUNS_PER_CELL,
		variant,
		fixture,
		afterImportRatio,
		failAtShare,
		...rest,
		id: `${fixture}-r${afterImportRatio}-${variant.id}${failure}${suffix ? `-${suffix}` : ''}`,
	}
}
