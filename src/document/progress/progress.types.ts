/**
 * Two-level projection stored on `DocumentState.progress`, derived from the
 * reporter's plan stack:
 *
 * - `current`/`total` come from the main plan (stack[0]); `label` shows the
 *   deepest plan's caption when it has one (more specific), else the main's;
 * - `step` is the deepest nested plan's own `current`/`total` (cosmetic sub-bar),
 *   or `null` when only the main plan is open.
 */
export type DocumentProgress = {
	current: number
	total: number
	label: string
	step: { current: number; total: number } | null
} | null

/** A plan level: how many steps it has and an optional caption. */
export type PlanInput = {
	steps: number
	label?: string
}

/**
 * Reporter methods for progress. Transaction builds a real one (writes into
 * `DocumentState.progress`); Query gets a no-op (see `noop-progress-reporter.ts`).
 *
 * Model: a STACK of plans. `plan()` pushes a level, `nextStep()` advances the
 * innermost level (close-previous: `current` = COMPLETED steps), `endPlan()` pops.
 * Nesting is automatic — a nested op writes `plan()`/`nextStep()`/`endPlan()`
 * identically whether it runs top-level or inside another plan.
 *
 * Balancing rule: every `plan()` you open you close with `endPlan()`, EXCEPT the
 * transaction body's main plan, which the transaction closes for you via
 * `forceClear()`. On a throw you skip `endPlan()` — `forceClear()` unwinds the
 * whole stack.
 */
export type ProgressReporter = {
	/** Push a plan level (child of the current innermost, or the main if none). */
	plan(plan: PlanInput): void
	/** Advance the innermost plan by one step (close-previous); optionally recaption. */
	nextStep(label?: string): void
	/** Pop the innermost plan. Clears progress only once the stack is empty. */
	endPlan(): void
	/** Unconditional clear — empties the whole plan stack regardless of balance. */
	forceClear(): void
}
