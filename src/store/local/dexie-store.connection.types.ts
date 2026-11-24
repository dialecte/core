/** A private step of the store after which a case reloads its connection. */
export type ReloadPoint = 'writeTable'

/** The store's private steps a case reaches: each point, and the reload of its connection. */
export type StoreInternals = Record<ReloadPoint, (...args: unknown[]) => Promise<unknown>> & {
	reloadFromPersisted: () => Promise<void>
}

/** The connection's events as a case fires one: a versionchange, as another tab's schema upgrade sends it. */
export type VersionchangeEvents = { versionchange: { fire: (event: Event) => void } }
