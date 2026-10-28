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
	| 'disk-full'

/** What a runtime test orders its engine worker on the fixture channel. */
export type RuntimeFixtureOrder =
	| { type: 'end' }
	| { type: 'throw-later' }
	| { type: 'slow' }
	| { type: 'slow-ddl' }
	| { type: 'disk-full'; afterWrites?: number }
	| { type: 'disk-free' }
	| { type: 'write-fails' }

/** What the fixture's engine workers say on the fixture channel: an order taken, a phase reached. */
export type RuntimeFixtureNotice =
	| { type: 'ack'; of: RuntimeFixtureOrder['type'] }
	/** The import reached a pause its file marks: `pause` (the parse), `after-pause` or `after-yield-pause`. */
	| { type: 'reached'; marker: 'pause' | 'after-pause' | 'after-yield-pause' }

/** What a runtime test tells its holder worker. */
export type RuntimeFixtureMessage = { type: 'hold'; project: string } | { type: 'release' }

/** A long statement the progress-beat fixture runs, its beats posted on `port`. */
export type ProgressBeatOrder = { port: MessagePort; intervalMs: number; rows: number }
