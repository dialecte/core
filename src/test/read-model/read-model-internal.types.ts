import type { LossyChannel, StoreGate } from './read-model-harness.types'
import type { Project } from '@/project/project'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

/** What a case opened, closed after it whatever it did. */
export type OpenedByCase = {
	readonly projects: Project<AnyDialecteConfig>[]
	readonly stores: Store[]
	readonly channels: LossyChannel[]
	readonly gates: StoreGate[]
}

/** A gate's own state: the store behind it, its call counts, the holds set per member, the notices held. */
export type GateState = {
	readonly store: Store
	readonly counts: Map<string, number>
	readonly holds: Map<string, Array<{ arrive: () => void; opened: Promise<void> }>>
	/** The release of every hold set: what `releaseAll` sends on, met or not. */
	readonly released: Array<() => void>
	readonly notices: { held: boolean; waiting: Array<() => void>; reached: () => void }
}
