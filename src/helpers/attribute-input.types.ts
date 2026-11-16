import type { Namespace } from '@/types'

/** An attribute as an author hands it to a write: a name, and its namespace as a `Namespace` or a config key. */
export type AttributeInput = {
	readonly name: string
	readonly namespace?: Namespace | string
}

/** An attribute input read: its stored name (`prefix:local` in a prefixed namespace) and the namespace it is in. */
export type ReadAttributeInput = {
	readonly name: string
	readonly namespace: Namespace | undefined
}
