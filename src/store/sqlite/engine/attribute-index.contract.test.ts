import { STORE_ATTRIBUTE_CONTRACT } from '../../contract/store-contract.attribute-lookup.cases'
import { attributeIndexTablesOf, readFilteredRecords } from './attribute-index'
import { seqOf } from './attribute-index.fixtures'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { StoreContractContext } from '../../contract/store-contract.types'
import type { SqliteEngine } from './engine.types'
import type { AttributeLookup, Store } from '@/store/store.types'
import type { AnyRawRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** The contract's own attribute-lookup groups: what the store answers, and after which writes. */
const GROUPS = ['attribute lookups', 'attribute lookups after writes'] as const

const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

/**
 * Whether the lookup reaches an index at all: a registered, ready document and entries that each hold a value
 * (a lookup with none answers nothing without one).
 */
async function reachesIndex(params: {
	engine: SqliteEngine
	lookup: AttributeLookup
}): Promise<boolean> {
	const { engine, lookup } = params
	const document = await engine.getDocument(lookup.documentId)
	if (document?.status !== 'ready' || lookup.attributes.length === 0) return false
	return lookup.attributes.every((entry) => entry.values.length > 0)
}

/** What the SQL filter answers for the lookup on the connection: the answer of a pair not built. */
function filteredOf(params: { db: Database; lookup: AttributeLookup }): AnyRawRecord[] {
	const { db, lookup } = params
	const seq = seqOf({ db, documentId: lookup.documentId })
	return readFilteredRecords({
		db,
		table: attributeIndexTablesOf({ seq }).records,
		tagName: lookup.tagName,
		attributes: lookup.attributes,
	})
}

/**
 * The engine as a store for the contract's attribute cases, each lookup made twice: as asked (cold: its pairs built
 * in the call), then again (warm, from the index). Both answers must be the SQL filter's; the second is the one the
 * case checks.
 */
function storeOfEngine(params: { engine: SqliteEngine; db: Database }): Store {
	const { engine, db } = params
	async function lookUpTwice(lookup: AttributeLookup): Promise<AnyRawRecord[]> {
		const asked = await engine.getByAttributes(lookup)
		if (!(await reachesIndex({ engine, lookup }))) return asked
		const filtered = filteredOf({ db, lookup })
		const fromIndex = await engine.getByAttributes(lookup)
		expect({ cold: asked, warm: fromIndex }, 'cold and warm answer as the filter does').toEqual({
			cold: filtered,
			warm: filtered,
		})
		return fromIndex
	}
	return new Proxy(engine as unknown as Store, {
		get: function memberOfEngine(target, property) {
			if (property === 'getByAttributes') return lookUpTwice
			if (property === 'commit') {
				return function commitOnEngine(commit: Parameters<Store['commit']>[0]) {
					const { onProgress, writeId = crypto.randomUUID(), ...writes } = commit
					return engine.commit({ ...writes, writeId }, onProgress)
				}
			}
			const member: unknown = Reflect.get(target, property, target)
			return typeof member === 'function' ? member.bind(target) : member
		},
	})
}

describe('the contract’s attribute lookups on the SQLite engine, cold, warm and filtered the same', () => {
	for (const group of GROUPS) {
		for (const [description, contractCase] of Object.entries(STORE_ATTRIBUTE_CONTRACT[group]!)) {
			it(`${group}: ${description}`, async () => {
				const db = (await openMemoryFile({ opened })).connect()
				const engine = await startEngine({ db })
				const store = storeOfEngine({ engine, db })
				await contractCase.act({ store } as StoreContractContext)
			})
		}
	}
})
