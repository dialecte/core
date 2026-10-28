/** A platform a runtime test shapes for its engine worker. */
export type RuntimeFixtureScenario =
	| 'no-opfs'
	| 'small-quota'
	| 'import-quota'
	| 'holder'
	| 'ignore-close'
	| 'endable'
	| 'uncaught-error'
	| 'broken'
	| 'slow-statements'
	| 'slow-statements-silent'
	| 'progress-beat'
	| 'liveness'

/** What a runtime test orders its engine worker on the fixture channel. */
export type RuntimeFixtureOrder = { type: 'end' } | { type: 'throw-later' } | { type: 'slow' }

/** What a runtime test tells its holder worker. */
export type RuntimeFixtureMessage = { type: 'hold'; project: string } | { type: 'release' }

/** A long statement the progress-beat fixture runs, its beats posted on `port`. */
export type ProgressBeatOrder = { port: MessagePort; intervalMs: number; rows: number }
