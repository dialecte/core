import type { Project } from '@/project/project'
import type { ProjectChannelMessage, StorageParam } from '@/project/types'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

/** How a case gets the storage of a project of its name: one of the stores a cache is proven on. */
export type ReadModelStorage = (params: {
	name: string
	dialecteId: string
}) => Promise<StorageParam>

/** A store member a gate can hold: any member answering a promise (`subscribe` answers at once, so it is never held). */
export type GatedMember = Exclude<
	{
		[GenericKey in keyof Store]-?: NonNullable<Store[GenericKey]> extends (
			...args: never[]
		) => Promise<unknown>
			? GenericKey
			: never
	}[keyof Store],
	'subscribe'
>

/** One held call of a gated store's member: reached once the call is made, answered once released. */
export type HeldCall = {
	/** Settles when a call of the member reached the gate (it waits there, not yet sent to the store). */
	readonly reached: Promise<void>
	/** Sends the waiting call on to the store. */
	release(): void
}

/**
 * A store behind a gate: the same members as the store it wraps, any one of which can be held so a read stays in
 * flight while a change lands; its notices can be held too (a late notice), and every member call is counted.
 */
export type StoreGate = {
	/** The gated store: pass it to a project as a `custom` storage. */
	readonly store: Store
	/** Holds the next call of `member` at the gate until released: it reaches the store only then. */
	hold(params: { member: GatedMember }): HeldCall
	/**
	 * Holds the answer of the next call of `member`: the store answers at once, its answer is given back only when
	 * released (an answer read before a change, coming back after it).
	 */
	holdAnswer(params: { member: GatedMember }): HeldCall
	/** Holds every notice the store tells its listeners until `releaseNotices`; reached once one is held. */
	holdNotices(): { readonly reached: Promise<void> }
	/** Tells the listeners every held notice, in the order the store told them, and stops holding. */
	releaseNotices(): void
	/** Releases every held call and every held notice: what a case left held never outlives it. */
	releaseAll(): void
	/** How many times each member was called through the gate. */
	readonly counts: ReadonlyMap<GatedMember | 'subscribe', number>
}

/**
 * The BroadcastChannel of the realm replaced while a case runs: a message of a type can be dropped (a lost message)
 * or held (a late one) as it is posted, then flushed in the order asked.
 */
export type LossyChannel = {
	/** Every message of `type` posted from now on is lost; reached once one is. */
	drop(params: { type: ProjectChannelMessage['type'] }): { readonly reached: Promise<void> }
	/** Every message of `type` posted from now on is held until `flush`. */
	hold(params: { type: ProjectChannelMessage['type'] }): void
	/** Posts the held messages, in the order given (`reversed` posts the last held first), and stops holding. */
	flush(params?: { reversed?: boolean }): void
	/** Gives the realm its BroadcastChannel back (when it is still this install's) and forgets what it held. */
	restore(): void
}

/** The uncached answers of a case, one per point it recorded (after each scripted write, and at its start). */
export type VersionTrail<GenericAnswer> = {
	/** Reads the uncached answer now and keeps it as the next point. */
	record(): Promise<void>
	/** The answers kept, oldest first. */
	readonly answers: readonly GenericAnswer[]
}

/** What one case of the runner is given: two projects of one name, the document they share, the reader's gate. */
export type ReadModelContext<GenericConfig extends AnyDialecteConfig = AnyDialecteConfig> = {
	/** The project that writes. */
	readonly writer: Project<GenericConfig>
	/** The project that reads, through `gate`. */
	readonly reader: Project<GenericConfig>
	/** The document the writer imported, open in both. */
	readonly documentId: string
	/** The gate the reader's store answers through. */
	readonly gate: StoreGate
	/** Whether the store announces its changes itself (otherwise the project channel carries them). */
	readonly announces: boolean
	/** The realm's channel, replaced for the case: drops and holds what the projects post. */
	readonly channel: LossyChannel
	/** A store of the name held directly: a write through it goes around both projects. */
	readonly around: Store
	/** The dialecte config both projects are of. */
	readonly config: GenericConfig
}

/** One case: its title (`<initial state> → <outcome>`) and what it does with the context. */
export type ReadModelCase<GenericConfig extends AnyDialecteConfig = AnyDialecteConfig> = {
	readonly title: string
	/** Runs only on stores that announce (`true`) or only on stores that do not (`false`); every store without it. */
	readonly announces?: boolean
	readonly act: (context: ReadModelContext<GenericConfig>) => Promise<void>
}

/** The runner's params: the stores to prove on, the dialecte of the two projects, the document they share, the cases. */
export type RunReadModelCasesParams<GenericConfig extends AnyDialecteConfig = AnyDialecteConfig> = {
	/** The describe block's title. */
	readonly title: string
	/** Each store a case runs on, by the name its describe block shows. */
	readonly storages: Readonly<Record<string, ReadModelStorage>>
	readonly config: GenericConfig
	readonly dialecteId: string
	/** The document the writer imports before each case, its records keeping the ids it gives. */
	readonly sourceXml: string
	readonly cases: readonly ReadModelCase<GenericConfig>[]
}
