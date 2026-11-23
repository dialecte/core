/** A private step of the store after which a case reloads its connection. */
export type ReloadPoint = 'writeTable' | 'readHead'

/** The store's private steps a case reaches: each point, and the reload of its connection. */
export type StoreInternals = Record<ReloadPoint, (...args: unknown[]) => Promise<unknown>> & {
	reloadFromPersisted: () => Promise<void>
}
