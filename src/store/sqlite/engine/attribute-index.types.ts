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

/** What the engine gives its builds of index pairs. */
export type AttributeBuildContext = {
	db: Database
	/** A write of the engine's own in one durable transaction (a build runs only while no import's window is open). */
	write: (work: () => void) => void
	/** Whether a failed build is one the engine gives up on (the file full, an I/O error, no memory): any other is thrown. */
	isGivenUp: (thrown: unknown) => boolean
}

/** The engine's builds of index pairs, each made inside the lookup that asks for it. */
export type AttributeIndexBuilder = {
	/**
	 * The pairs registered, built over the whole tag and marked `ready` in one transaction; whether they were. A
	 * build that fails is rolled back and its pairs are not tried again until the engine starts again.
	 */
	build: (params: {
		documentId: string
		tables: AttributeIndexTables
		tagName: string
		names: readonly string[]
	}) => boolean
	/** The document removed: its failed pairs forgotten (one registered again builds anew). */
	forget: (params: { documentId: string }) => void
}
