import type { Store } from '../store.types'
import type { BaseTestCase } from '@/test'
import type { AnyAttribute } from '@/types'

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
}

/** What a case is given: the store under test and the factory's two ways to see its state again. */
export type StoreContractContext = {
	store: Store
	/** Replace `store` with a fresh connection to the same state; the old one is closed. */
	reopen: () => Promise<Store>
	/** A second open connection to the same state; closed after the case. */
	connect: () => Promise<Store>
}

export type StoreContractCase = BaseTestCase & {
	/** `second-connection`: the case needs `connect`; skipped on a leg that has none. */
	needs?: 'second-connection'
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
	read: (store: Store) => Promise<unknown>
	expected: unknown
}

/** A sibling-order case: the steps taken, the order of the parent's children after them. */
export type SiblingOrderStep = {
	run: (context: StoreContractContext) => Promise<void>
	expected: string[]
}

/** The contract, one table of cases per concern. */
export type StoreContractGroups = Record<string, StoreContractCases>
