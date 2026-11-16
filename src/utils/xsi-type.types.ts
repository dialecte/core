import type { AnyDialecteConfig, Namespace } from '@/types'

/** What the readers need of a dialecte config: its namespaces. */
export type NamespacesConfig = Pick<AnyDialecteConfig, 'namespaces'>

/** An attribute as the readers see it, parsed or created. */
export type AttributeLike = {
	readonly name: string
	readonly value: unknown
	readonly namespace?: Namespace
}

/** The namespace uri a prefix names (`''` for the default namespace); `undefined` when it is bound nowhere. */
export type NamespaceLookup = (prefix: string) => string | undefined

/** A type an element names with xsi:type: its Clark name (`{uri}local`, bare `local` in no namespace), parts. */
export type XsiTypeName = {
	readonly clark: string
	/** `''` for no namespace. */
	readonly namespace: string
	readonly local: string
}
