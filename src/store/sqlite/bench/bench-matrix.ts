/**
 * The bench matrix: which variant runs on which input, how many times, measuring what. Cells run only
 * when `VITE_BENCH_CELLS` selects them; ids are `<fixture>-r<write-back ratio>-<variant>[-fail<n>][-<suffix>]`.
 */
import {
	AFTER_IMPORT_RATIOS,
	ALL_MEASURES,
	BOTH_RATIOS,
	CACHE_CEILING_VARIANTS,
	MAIN_DIMENSIONS,
	RUNS_PER_CELL,
	STRUCTURAL,
	VARIANTS,
} from './bench.constants'

import type { BenchCell } from './bench.types'

function cell(
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

/**
 * Order cells first (the red-first assertion on the small catalogue), then 50, 100 and 500 MB.
 * One dimension changes per arm; the cache and per-row arms run at 50 MB only.
 */
export const BENCH_CELLS: readonly BenchCell[] = [
	...[VARIANTS.base, VARIANTS.L2].map((variant) =>
		cell({
			variant,
			fixture: 'composed-catalogue-small',
			afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
			runs: 1,
			measures: { order: true },
		}),
	),
	...Object.values(VARIANTS).flatMap((variant) =>
		BOTH_RATIOS.map((afterImportRatio) =>
			cell({
				variant,
				fixture: 'composed-50-compact',
				afterImportRatio,
				// index-first with L2's three indexes is minutes at 50 MB: one run tells enough
				runs: variant === VARIANTS.L2I1 ? 1 : RUNS_PER_CELL,
				measures: { ...ALL_MEASURES, order: true },
			}),
		),
	),
	...MAIN_DIMENSIONS.flatMap((variant) =>
		BOTH_RATIOS.map((afterImportRatio) =>
			cell({ variant, fixture: 'composed-50-indented', afterImportRatio, measures: ALL_MEASURES }),
		),
	),
	...(['composed-100-compact', 'composed-100-indented'] as const).flatMap((fixture) =>
		MAIN_DIMENSIONS.map((variant) =>
			cell({
				variant,
				fixture,
				afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
				measures: ALL_MEASURES,
			}),
		),
	),
	...[
		VARIANTS.base,
		VARIANTS.L2,
		VARIANTS.I1,
		VARIANTS.J2,
		VARIANTS.W2,
		VARIANTS.V2,
		VARIANTS.idFirst,
		VARIANTS.steadyDevice,
	].map((variant) =>
		cell({
			variant,
			fixture: 'composed-500-compact',
			afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
			// index-first is the slowest arm at 50 MB: one run at 500 MB
			runs: variant === VARIANTS.I1 ? 1 : RUNS_PER_CELL,
			measures: ALL_MEASURES,
		}),
	),
	// the combined arm at 500 MB (its 50 MB cell comes from the 50 MB list, which takes every variant)
	cell({
		variant: VARIANTS.combined,
		fixture: 'composed-500-compact',
		afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
		measures: ALL_MEASURES,
	}),
	// commits during the import over 3 runs without the profiler: commits from the page during every timed import, then the edits
	...[VARIANTS.base, VARIANTS.idFirst, VARIANTS.combined, VARIANTS.idFirstHalfWindow].map(
		(variant) =>
			cell({
				variant,
				fixture: 'composed-500-compact',
				afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
				suffix: 'commits',
				measures: { commitsDuringImport: true, edits: true },
			}),
	),
	// caches above the device-sized ceiling against the locked layout (V2), commits during the import and the edits
	// one run each: the question is whether a big cache pays at all
	...[VARIANTS.V2, ...Object.values(CACHE_CEILING_VARIANTS)].map((variant) =>
		cell({
			variant,
			fixture: 'composed-500-compact',
			afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
			runs: 1,
			suffix: 'commits',
			measures: { commitsDuringImport: true, edits: true },
		}),
	),
	// edits and reads at 500 MB with SQLite's default steady cache (2 MiB) against the 64 MiB base
	cell({
		variant: VARIANTS.steadyDefault,
		fixture: 'composed-500-compact',
		afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
		runs: 1,
		measures: { edits: true, reads: true },
	}),
	// the prepared-database path holds the whole file in memory twice: its own run, so a tab crash loses nothing else
	...[VARIANTS.base, VARIANTS.L2].map((variant) =>
		cell({
			variant,
			fixture: 'composed-500-compact',
			afterImportRatio: AFTER_IMPORT_RATIOS.setWritten,
			runs: 1,
			suffix: 'prepared',
			measures: { prepared: true },
		}),
	),
	...[VARIANTS.base, VARIANTS.L2].flatMap((variant) => [
		cell({
			variant,
			fixture: 'composed-500-indented',
			afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
			measures: ALL_MEASURES,
		}),
		cell({
			variant,
			fixture: 'composed-500-compact',
			afterImportRatio: AFTER_IMPORT_RATIOS.setWritten,
			measures: ALL_MEASURES,
		}),
	]),
	...[VARIANTS.base, VARIANTS.V2].map((variant) =>
		cell({
			variant,
			fixture: 'composed-500-compact',
			afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
			failAtShare: 0.8,
			measures: {},
		}),
	),
	...STRUCTURAL.flatMap((fixture) =>
		[VARIANTS.base, VARIANTS.L2].map((variant) =>
			cell({
				variant,
				fixture,
				afterImportRatio: AFTER_IMPORT_RATIOS.pathNamed,
				measures: ALL_MEASURES,
			}),
		),
	),
]
