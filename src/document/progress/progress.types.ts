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
 * `DocumentState.progress`); Query gets a no-op (see `noop-progress-reporter.constants.ts`).
 *
 * Model: a STACK of plans. `plan()` pushes a level, `nextStep()` advances the
 * innermost level (close-previous: `current` = COMPLETED steps), `endPlan()` pops.
 * Nesting is automatic — a nested op writes `plan()`/`nextStep()`/`endPlan()`
 * identically whether it runs top-level or inside another plan.
 *
 * Balancing rule: open a plan with `runInPlan()` when your op runs nested ops or may throw - it closes its own
 * scope, on success and on a throw, whoever catches. A hand-written `plan()` / `endPlan()` pair stays for a flat
 * plan that cannot throw. The transaction body's main plan is the exception: the transaction closes it for you via
 * `forceClear()`. Run plan-opening ops on one transaction one at a time (no `Promise.all` of two ops that each open a
 * plan): one stack cannot hold ops running at once, and the end of one, on success or on a throw, cuts the other's
 * frames. A transaction that ends, a prepare that throws and a prepared transaction committed or discarded clear
 * the whole stack.
 */
export type ProgressReporter = {
	/**
	 * Push a plan level (child of the current innermost, or the main if none).
	 *
	 * @intent report progress of a long operation, announce how many steps a transaction or nested step has, show a progress bar caption
	 */
	plan(plan: PlanInput): void
	/**
	 * Advance the innermost plan by one step (close-previous); optionally recaption.
	 *
	 * @intent mark a progress step done, update the progress caption
	 */
	nextStep(label?: string): void
	/**
	 * Pop the innermost plan. Clears progress only once the stack is empty.
	 *
	 * @intent close a nested progress plan, finish reporting progress for a step
	 */
	endPlan(): void
	/**
	 * Run `run` inside one plan of its own: push `plan`, await `run`, then cut the stack back to the depth it had
	 * before - this plan's frame and any frame a nested op left open above it, in one event - whether `run` answers or
	 * throws (a synchronous throw included); a throw is thrown again. A balanced body ends exactly as a hand-written
	 * `plan()` / `endPlan()` pair. `run` steps its own plan with `nextStep()`; runs nest. One plan-opening op at a time
	 * per transaction: a run that ends cuts the frames of another run started after it. A body that calls
	 * `forceClear()` leaves the run nothing to close. The query's no-op reporter answers `run`'s result and rejects
	 * with its error.
	 *
	 * @intent run a step inside a progress plan that always closes, report progress of a nested op that may throw
	 */
	runInPlan<GenericResult>(params: {
		plan: PlanInput
		run: () => Promise<GenericResult>
	}): Promise<GenericResult>
	/**
	 * Unconditional clear — empties the whole plan stack regardless of balance. `Document.transaction`
	 * calls it when it ends or fails.
	 *
	 * @internal Used by the transaction to reset progress when it ends.
	 */
	forceClear(): void
}
