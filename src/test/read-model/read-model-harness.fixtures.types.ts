import type { Project } from '@/project/project'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

/** What a harness test file opened, closed after each case. */
export type HarnessTracked = {
	readonly projects: Project<AnyDialecteConfig>[]
	readonly stores: Store[]
	readonly restores: Array<() => void>
}

/** The source project's document and a store of its name held directly. */
export type OpenedSource = { store: Store; documentId: string; name: string }
