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
	| 'destroy-told'
	| 'ignore-destroy'
	| 'slow-destroy'
	| 'close-throws'
	| 'other-wire'
	| 'install-fails'
	| 'install-fails-on-one'
	| 'install-fails-once'
	| 'sqlite-3-53'
	| 'hooks-fail'
	| 'database-fails'
	| 'silent-open'
	| 'silent-adopt'
	| 'other-dialecte'
	| 'unchecked-open'
	| 'stranded-window'

/** What a runtime test orders its engine worker on the fixture channel. */
export type RuntimeFixtureOrder =
	| { type: 'end' }
	| { type: 'throw-later' }
	| { type: 'slow' }
	| { type: 'slow-ddl' }
	| { type: 'disk-full'; afterWrites?: number }
	| { type: 'disk-free' }
	| { type: 'write-fails' }
	| { type: 'close-throws' }
	| { type: 'strand-windows' }

/** What the fixture's engine workers say on the fixture channel: an order taken, a phase reached. */
export type RuntimeFixtureNotice =
	| { type: 'ack'; of: RuntimeFixtureOrder['type'] }
	/**
	 * The import reached a pause its file marks: `pause` (the parse), `after-pause` or `after-yield-pause`; or
	 * a slowed statement began (`slow-ddl`), the engine told busy.
	 */
	| { type: 'reached'; marker: 'pause' | 'after-pause' | 'after-yield-pause' | 'slow-ddl' }
	/** A `destroy` of `project` reached the worker (the destroy scenarios): one per worker asked. */
	| { type: 'destroy-asked'; project: string }

/** How a fixture engine worker takes a `destroy`: swallowed, handed over late, or at once. */
export type DestroyShape = 'deaf' | 'late' | 'at-once'

/** What a runtime test tells its holder worker. */
export type RuntimeFixtureMessage = { type: 'hold'; project: string } | { type: 'release' }

/** A long statement the progress-beat fixture runs, its beats posted on `port`. */
export type ProgressBeatOrder = { port: MessagePort; intervalMs: number; rows: number }

/**
 * How the install-failure fixtures refuse a pool file's second handle (the probe opened the first): on every
 * file or on the first file probed only (the others acquired), every time or once.
 */
export type PoolInstallFailure = { files: 'every' | 'first'; once: boolean }
