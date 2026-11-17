import { STORE_ATTRIBUTE_CONTRACT } from '../../contract/store-contract.attribute-lookup.cases'
import { pairStatesOf, seqOf } from './attribute-index.fixtures'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { StoreContractContext } from '../../contract/store-contract.types'
import type { SqliteEngine } from './engine.types'
import type { AttributeLookup, Store } from '@/store/store.types'
import type { AnyRawRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** The contract's own attribute-lookup groups: what the store answers, and after which writes. */
const GROUPS = ['attribute lookups', 'attribute lookups after writes'] as const

/** Message turns a lookup's pairs may take to be built on a contract fixture (a handful of records). */
const READY_TURNS = 1_000

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

/** Wait, a message turn at a time, until every pair the lookup asks of its tag is `ready`. */
async function untilLookupReady(params: { db: Database; lookup: AttributeLookup }): Promise<void> {
	const { db, lookup } = params
	const seq = seqOf({ db, documentId: lookup.documentId })
	const pairs = lookup.attributes.map((entry) => `${lookup.tagName}.${entry.name}`)
	for (let turn = 0; turn < READY_TURNS; turn += 1) {
		const states = pairStatesOf({ db, seq })
		if (pairs.every((pair) => states[pair] === 'ready')) return
		await new Promise((resolve) => setTimeout(resolve))
	}
	throw new Error(`the pairs ${pairs.join(', ')} were never built`)
}

/**
 * The engine as a store for the contract's attribute cases, each lookup made twice: as asked (the SQL filter on a
 * pair not built yet), then once its pairs are ready (from the index). Both answers must be the same; the second is
 * the one the case checks.
 */
function storeOfEngine(params: { engine: SqliteEngine; db: Database }): Store {
	const { engine, db } = params
	async function lookUpTwice(lookup: AttributeLookup): Promise<AnyRawRecord[]> {
		const asked = await engine.getByAttributes(lookup)
		if (!(await reachesIndex({ engine, lookup }))) return asked
		await untilLookupReady({ db, lookup })
		const fromIndex = await engine.getByAttributes(lookup)
		expect(fromIndex, 'the index answers as the filter did').toEqual(asked)
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

describe('the contract’s attribute lookups on the SQLite engine, read again from the built index', () => {
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
