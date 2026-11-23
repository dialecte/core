import type { PlanStack, ProgressReporter } from './progress.types'

/**
 * The plan stack of each reporter `createProgressReporter` made; the no-op reporter of a query has none.
 *
 * @internal read through `planStackOf`
 */
export const PLAN_STACKS = new WeakMap<ProgressReporter, PlanStack>()
