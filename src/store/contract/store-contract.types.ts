import type { ImportFileOptions, Store } from '../store.types'
import type { DialecteErrorKey } from '@/errors'
import type { DocumentRecord } from '@/project/types'
import type { BaseTestCase } from '@/test'
import type { AnyAttribute, AnyRawRecord, BlobRecord } from '@/types'

/**
 * One leg of the store contract: how to get a store of that kind, and how to see its state again
 * through a fresh connection. The suite runs every case over every factory.
 */
export type StoreContractFactory = {
	/** The leg's name in the test output. */
	name: string
	/** A fresh, open store on a name of its own. */
	create: () => Promise<Store>
	/**
	 * The same state through a fresh connection, the given one closed: what a reload sees. A store
	 * that serves one realm and keeps nothing reopens itself.
	 */
	reopen: (store: Store) => Promise<Store>
	/**
	 * A second connection, open at the same time as the given one, to the same state: what another
	 * realm sees. Absent when the store serves one realm only.
	 */
	connect?: (store: Store) => Promise<Store>
	/**
	 * The parts of the port this leg does not serve yet, each with the reason its waiting cases show:
	 * a case needing one runs as expected to fail on this leg (never in a weaker form), so it turns red
	 * once the leg serves the part and the entry is left behind.
	 */
	pending?: Partial<Record<StoreContractFeature, string>>
	/** The store's storage made full: from now on a write that needs more room than it has is refused. */
	fillStorage?: (params: { store: Store }) => Promise<void>
	/**
	 * Why a test cannot fill this leg's storage (set when `fillStorage` is not): the cases needing a full
	 * storage are skipped on it with this reason.
	 */
	storageUnfillable?: string
}

/** A part of the port a leg may not serve yet. */
export type StoreContractFeature = 'history' | 'blobs' | 'import' | 'export'

/**
 * What a case needs of a leg beyond the registry, the reads and the bulk writes: a second connection
 * (`connect`), a storage it can fill (`fillStorage`), or a part of the port.
 */
export type StoreContractNeed = 'second-connection' | 'full-storage' | StoreContractFeature

/** What a case is given: the store under test and the factory's two ways to see its state again. */
export type StoreContractContext = {
	store: Store
	/** Replace `store` with a fresh connection to the same state; the old one is closed. */
	reopen: () => Promise<Store>
	/** A second open connection to the same state; closed after the case. */
	connect: () => Promise<Store>
	/** A fresh, open store of another name; destroyed after the case. */
	createOther: () => Promise<Store>
	/** The store's storage made full (`full-storage`): a write needing more room than it has is refused. */
	fillStorage: () => Promise<void>
}

/** What a held import and its case say on the hold channel. */
export type ContractHoldMessage = { type: 'reached' } | { type: 'release' }

/** An import the case holds at the end of its parse: `reached` once it waits, `release` lets it go on. */
export type ContractImportHold = {
	/** What a file's record of the session's tag carries in `bB` to be held by this hold. */
	value: string
	reached: Promise<void>
	release: () => void
}

export type StoreContractCase = BaseTestCase & {
	/**
	 * `second-connection`: skipped on a leg without `connect`; `full-storage`: skipped on a leg whose
	 * storage a test cannot fill, with its reason; a part of the port: run as expected to fail on a leg
	 * that has it pending.
	 */
	needs?: StoreContractNeed[]
	act: (context: StoreContractContext) => Promise<void>
}

export type StoreContractCases = Record<string, StoreContractCase>

/** A bulk-write patch case: the attributes held, the patch, the attributes after it. */
export type AttributePatchCase = {
	attributes: AnyAttribute[]
	patch: { attributes?: AnyAttribute[]; removeAttributes?: string[] }
	expectedAttributes: AnyAttribute[]
}

/** A read of a document that is not in the store, and what it must answer. */
export type AbsentDocumentRead = {
	needs?: StoreContractFeature[]
	read: (store: Store) => Promise<unknown>
	expected: unknown
}

/** A sibling-order case: the steps taken, the order of the parent's children after them. */
export type SiblingOrderStep = {
	needs?: StoreContractFeature[]
	run: (context: StoreContractContext) => Promise<void>
	expected: string[]
}

/** The contract, one table of cases per concern. */
export type StoreContractGroups = Record<string, StoreContractCases>

/** A list read and the ids of what it answers, after its subject was written out of id order. */
export type OrderedRead = {
	needs?: StoreContractFeature[]
	read: (store: Store) => Promise<string[]>
}

/** A read whose answer the caller then changes: the store must answer the next read as before. */
export type ValueRead = (store: Store) => Promise<unknown>

/**
 * A write of a value the caller then changes: `write` hands the store `given`, `read` reads back what
 * the write left; the store must answer that read as it did right after the write.
 */
export type ValueWrite<GenericGiven extends object = object> = {
	given: () => GenericGiven
	write: (params: { store: Store; given: GenericGiven }) => Promise<void>
	read: ValueRead
}

/** A write breaking one or more rules (a value that is not JSON among them), and the refusal it must answer. */
export type RefusedWrite = {
	needs?: StoreContractNeed[]
	write: (store: Store) => Promise<void>
	key: DialecteErrorKey
}

/** A write handing the store `value` where it writes: one that is not JSON is refused there. */
export type NonJsonPlace = {
	needs?: StoreContractNeed[]
	write: (params: { store: Store; value: unknown }) => Promise<void>
}

/**
 * A write handing the store `value` under `levelsAbove` arrays and objects of its own, and the read
 * answering it back: every store keeps a value nested to the depth limit and refuses one level more.
 */
export type NestingPlace = {
	levelsAbove: number
	write: (params: { store: Store; value: unknown }) => Promise<void>
	read: (store: Store) => Promise<unknown>
}

/** An operation through a store, run once the store is closed. */
export type StoreOperation = (store: Store) => Promise<unknown>

/**
 * An operation started on a store and running when `close()` is called: it completes, `expected`
 * reads (once the store is opened again) what it did.
 */
export type OperationInFlight = {
	run: (store: Store) => Promise<unknown>
	expected: (store: Store) => Promise<void>
}

/** The source's records `A` and `C`, each with its attribute edited. */
export type EditedRecords = { a: AnyRawRecord; c: AnyRawRecord }

/** A write on a document while it is exported: what is done before the export, and the write itself. */
export type WriteDuringExport = {
	needs?: StoreContractNeed[]
	arrange?: (params: WriteDuringExportParams) => Promise<void>
	write: (params: WriteDuringExportParams) => Promise<void>
}

export type WriteDuringExportParams = {
	store: Store
	/** The store the write goes through: the exporting one, or a second connection opened before the export */
	writer: Store
	documentId: string
	edited: EditedRecords
}

/**
 * A call naming, at one key place, a key that is not well-formed, and what it answers: the answer for a key
 * not held (`answers`), or the refusal of one (`refused`).
 */
export type KeyedCall = {
	needs?: StoreContractNeed[]
	call: (store: Store) => Promise<unknown>
} & ({ answers: unknown } | { refused: DialecteErrorKey; meta?: Record<string, unknown> })

/** A text value through an import: what the store holds for the record, and the file it exports (compact). */
export type ImportedTextValue = { value: string | undefined; exported: string }

/** What a "text kept as written" case writes: each text of a document, a record, a commit and a blob holding one kept text. */
export type KeptTextWrite = {
	document: DocumentRecord
	record: AnyRawRecord
	blob: BlobRecord
	writeId: string
}

/** An import handing a lone surrogate: the write id it runs under, its options, the body of its file. */
export type ImportWithLoneSurrogate = {
	writeId: string
	options?: ImportFileOptions
	body?: string
}

/** A write handing a store, at one place, text holding a lone surrogate. */
export type TextPlace = {
	needs?: StoreContractNeed[]
	write: (store: Store) => Promise<unknown>
}
