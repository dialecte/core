import 'vitest'

declare module 'vitest' {
	/** What the vitest config provides the tests (`provide` in the config, `inject` in a test). */
	export interface ProvidedContext {
		/** The store contract's full-table switch as the config read it: the legs compare what their realm sees with it. */
		STORE_CONTRACT_FULL_TABLE: string
	}
}
