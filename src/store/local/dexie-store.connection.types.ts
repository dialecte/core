/** A private step of the store after which a case reloads its connection. */
export type ReloadPoint = 'writeTable'

/** The store's private steps a case reaches: each point, and the reload of its connection. */
export type StoreInternals = Record<ReloadPoint, (...args: unknown[]) => Promise<unknown>> & {
	reloadFromPersisted: () => Promise<void>
	withSchemaLock: (work: () => Promise<void>) => Promise<void>
}

/** The connection's events as a case fires one: a versionchange, as another tab's schema upgrade sends it. */
export type VersionchangeEvents = { versionchange: { fire: (event: Event) => void } }

/** A connection's open held in a test: reached once held, released on demand, the prototype restored after. */
export type HeldOpen = { reached: Promise<void>; release: () => void; restore: () => void }
