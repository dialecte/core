import type { QualifiedName } from './qname-value.types'
import type { Namespace } from '@/types'

export type { NamespaceLookup, NamespacesConfig } from './qname-value.types'

/** An attribute as the readers see it, parsed or created. */
export type AttributeLike = {
	readonly name: string
	readonly value: unknown
	readonly namespace?: Namespace
}

/** A type an element names with xsi:type: its Clark name (`{uri}local`, bare `local` in no namespace), parts. */
export type XsiTypeName = QualifiedName
