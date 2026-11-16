import type { AnyDialecteConfig } from '@/types'

/** What the readers need of a dialecte config: its namespaces. */
export type NamespacesConfig = Pick<AnyDialecteConfig, 'namespaces'>

/** The namespace uri a prefix names (`''` for the default namespace); `undefined` when it is bound nowhere. */
export type NamespaceLookup = (prefix: string) => string | undefined

/** A qualified name read: its Clark name (`{uri}local`, bare `local` in no namespace) and its parts. */
export type QualifiedName = {
	readonly clark: string
	/** `''` for no namespace. */
	readonly namespace: string
	readonly local: string
}
