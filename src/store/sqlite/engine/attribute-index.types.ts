import type { ATTRIBUTE_PAIR_STATE } from './attribute-index.constants'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** The tables of a record table's attribute index, and the prefix of its triggers' names. */
export type AttributeIndexTables = {
	records: string
	names: string
	rows: string
	keys: string
	triggers: string
}

/** Where a registered (tag, attribute) pair of the index stands. */
export type AttributePairState = (typeof ATTRIBUTE_PAIR_STATE)[keyof typeof ATTRIBUTE_PAIR_STATE]

/** The record row whose index rows a statement computes, as SQL expressions: in a trigger (`NEW`, `OLD`) or a table read. */
export type IndexKeysSource = {
	/** A table read the row comes from, with its alias and a trailing comma; none in a trigger. */
	from?: string
	tag: string
	attributes: string
	row: string
	/** More conditions, each starting with `AND`. */
	where?: string
}

/** A pair of a document's index asked by a lookup and not `ready`: built in the background. */
export type AttributePairBuild = {
	documentId: string
	tagName: string
	name: string
}

/** What the engine gives its builds of index pairs. */
export type AttributeBuildContext = {
	db: Database
	/** A write of the engine's own in one durable transaction, once the import that runs is settled. */
	write: (work: () => void) => void
	isClosed: () => boolean
	/** The end of the import that runs: no slice until it has ended. */
	giveWayTo: () => Promise<void> | undefined
	/** How long the slices run before the calls waiting get a turn. */
	sliceMs: number
	/** Called after each slice: the engine is alive, whoever waits on it. */
	onStep?: () => void
}

/** The engine's builds of index pairs, run one at a time in the background, never inside a call. */
export type AttributeIndexBuilder = {
	/** Queue the builds of these pairs (a pair queued or failed since the engine started is left). */
	queue: (params: { documentId: string; tagName: string; names: readonly string[] }) => void
}
