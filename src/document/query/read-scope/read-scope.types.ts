import type { Store, StoreVersion } from '@/store'
import type { AnyRawRecord } from '@/types'

/**
 * What one public verb call has read, answered again to the calls nested in it: the records by id (an id the store
 * answered as absent is held as `undefined`), the ids each tag read and each attribute lookup answered, and the ids of
 * the whole document once read. Opened empty when the call starts, closed when it settles; dropped whole when the
 * document's read epoch or store version moves.
 *
 * @internal state of the query layer's read scope
 */
export type ReadScope = {
	readonly documentId: string
	/** The document's read epoch the maps were filled at. */
	epoch: number
	/** The store version of the answers the maps hold; `undefined` before the first answer. */
	version: StoreVersion | undefined
	readonly records: Map<string, AnyRawRecord | undefined>
	readonly tagAnswers: Map<string, string[]>
	readonly attributeAnswers: Map<string, string[]>
	documentAnswer: string[] | undefined
	/** Set when its call settled: a query kept past it opens a fresh scope. */
	closed: boolean
	/** The document's read epoch now (moved by every write the Project makes or folds). */
	readonly epochOf: () => number
}

/**
 * What a Document attaches to each Query it builds so a verb call can open a scope: the document's read epoch and the
 * binding of the query extensions to a scoped query.
 *
 * @internal wiring of the query layer's read scope
 */
export type ReadScopeWiring = {
	readonly documentId: string
	readonly epochOf: () => number
	readonly bindQueryExtensions: (target: object) => Record<string, unknown>
}

/** A store that answers versioned reads (`Store.readVersioned` present). */
export type VersionedStore = Store & Required<Pick<Store, 'readVersioned'>>

/** What any read member answers: a record, absent, or a list of them. */
export type ScopedReadValue = AnyRawRecord | undefined | (AnyRawRecord | undefined)[]
