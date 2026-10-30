import type { EngineStore } from './engine-store'
import type { INNER_MEMBERS } from './engine-store.fixtures.constants'
import type { EngineConnector } from './engine-store.types'
import type { EngineApi } from './engine.types'

/** One act for every member the store calls itself. */
export type MemberActs = Record<Exclude<keyof EngineApi, InnerMember>, MemberAct>

/** Every call that reached an engine through a losing connector: its member, and which engine (in handing order) it reached. */
export type CallLog = { member: keyof EngineApi; lost: boolean; engine: number }[]

/** A call of the store that makes one call of its engine's member, on the store `losingStore` seeds. */
export type MemberAct = (store: EngineStore) => Promise<unknown>

/** The members the store calls only from inside another call (an import's, an export's abort). */
export type InnerMember = (typeof INNER_MEMBERS)[number]

/** What a store's state reads as: compared before and after a read. */
export type StoreState = {
	documents: unknown[]
	records: unknown[]
	changeLog: unknown[]
	history: unknown
	blobs: unknown[]
	/** Which of the blobs the acts touch are there. */
	blobsThere: boolean[]
	/** The blobs attached to the records the acts touch. */
	attachments: unknown[][]
}

/**
 * A connector with no engine behind it, whose links count open until closed and whose destroy does as its
 * `GatedDestroy` says: a case holds its next connect or destroy until it lets it go.
 */
export type GatedConnector = {
	connector: EngineConnector
	/** The links made and not closed yet. */
	openLinks: () => number
	/** How many connects and destroys were asked for. */
	asked: () => { connects: number; destroys: number }
	/** The most destroys that ran at once. */
	mostDestroysAtOnce: () => number
	/** Hold the next connect (or destroy) until the function answered is called. */
	holdNext: (params: { call: GatedCall }) => () => void
}

/** What a gated connector's destroy does once let go: refuse, or go ahead (the store's link let go) and fail. */
export type GatedDestroy = 'refuse' | 'fail-gone-ahead'

/** A call of a gated connector a case can hold. */
export type GatedCall = 'connect' | 'destroy'
