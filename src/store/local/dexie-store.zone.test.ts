import { makeRecord } from '../contract/store-contract.fixtures'
import { DexieStore } from './dexie-store'

import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { newCallId } from '@/store/json-values'
import { TABLE_CHANGELOG } from '@/store/store.constants'

import type { DocumentRecord } from '@/project'

// A request a transaction's work makes after a native await, Dexie's zone of that transaction lost meanwhile (a busy
// page): it still lands in the transaction, which never commits under the work.

const opened: DexieStore[] = []
const names: string[] = []

afterEach(async () => {
	for (const store of opened.splice(0)) await store.close()
	for (const name of names.splice(0)) await Dexie.delete(name)
})

/** A store of a new name holding document `a` with record `r1` and one commit. */
async function seededStore(): Promise<DexieStore> {
	const name = `dexie-zone-${crypto.randomUUID()}`
	names.push(name)
	const store = new DexieStore(name)
	opened.push(store)
	await store.open()
	const document: DocumentRecord = {
		id: 'a',
		name: 'a',
		extension: '.xml',
		configKey: 'default',
		createdAt: 0,
		status: 'ready',
	}
	await store.registerDocument(document)
	await store.bulkWrite('a', { creates: [makeRecord({ id: 'r1' })] })
	await store.commit({
		documentId: 'a',
		writeId: newCallId(),
		creates: [makeRecord({ id: 'r2' })],
		updates: [],
		deletes: [],
		onProgress: function ignoreProgress() {},
	})
	return store
}

function idsOrNone(records: ReadonlyArray<{ id: string } | undefined>): (string | undefined)[] {
	return records.map(function idOf(record) {
		return record?.id
	})
}

/** What a call settles with: its answer, or the refusal's text. */
function settled(call: Promise<unknown>): Promise<unknown> {
	return call.then(
		function answered(answer) {
			return { answer }
		},
		function refused(thrown: unknown) {
			return { thrown: String(thrown) }
		},
	)
}

/**
 * The next request of `tableName` made as if Dexie had lost the zone of the transaction around it (the requests Dexie
 * makes inside that one keep the zone they are given, as a lost zone does not reach them). A table bound to its
 * transaction still places the request there, at once. A table bound to none finds no transaction: its request goes to
 * one of its own, a task later as under load - the transaction around it, left with nothing to do, has committed by then.
 */
function losingTheZoneFor(tableName: string): { restore: () => void; lost: () => boolean } {
	const probe = new Dexie(`zone-probe-${crypto.randomUUID()}`)
	// each Dexie instance derives its own Table class from the one prototype every table shares
	const tablePrototype = Object.getPrototypeOf(probe.Table.prototype) as {
		_trans: (...args: unknown[]) => unknown
	}
	const request = tablePrototype._trans
	let lost = false
	const spy = vi.spyOn(tablePrototype, '_trans').mockImplementation(function outOfZone(
		this: { name: string; _tx?: unknown },
		...args: unknown[]
	) {
		const requestOfThisTable = request.bind(this)
		if (lost || this.name !== tableName) return requestOfThisTable(...args)
		lost = true
		const bound = this._tx !== undefined
		return Dexie.ignoreTransaction(function outsideTheZone() {
			if (bound) return requestOfThisTable(...args)
			return new Dexie.Promise(function aTaskLater(resolve) {
				setTimeout(resolve, 0)
			}).then(function requestNow() {
				return requestOfThisTable(...args)
			})
		})
	})
	return {
		restore: function restoreZone() {
			spy.mockRestore()
		},
		lost: function zoneLost() {
			return lost
		},
	}
}

/**
 * The second transaction the store opens started in the zone of the first, once the first has ended: as a call made
 * while Dexie echoes another call's zone. Settled once both transactions have been asked for.
 */
function secondInZoneOfFirst(): { restore: () => void; started: () => number } {
	const transaction = Dexie.prototype.transaction as (...args: unknown[]) => Promise<unknown>
	let started = 0
	let releaseSecond: () => void = function noSecondYet() {}
	let runSecond: () => void = function noSecondYet() {}
	const secondAsked = new Dexie.Promise<void>(function waitForSecond(resolve) {
		releaseSecond = resolve
	})
	const spy = vi.spyOn(Dexie.prototype, 'transaction').mockImplementation(function inZoneOfFirst(
		this: Dexie,
		...args: unknown[]
	) {
		started += 1
		const transactionHere = transaction.bind(this)
		if (started === 1) {
			const work = args[args.length - 1] as (...given: unknown[]) => unknown
			args[args.length - 1] = function firstWork(...given: unknown[]) {
				// a Dexie promise's callback runs in the zone it was chained in: this one's, after it has ended
				secondAsked
					.then(function afterTheFirstEnds() {
						return new Dexie.Promise(function aWhileLater(resolve) {
							setTimeout(resolve, 20)
						})
					})
					.then(function startTheSecond() {
						runSecond()
					})
				return work(...given)
			}
			return transactionHere(...args)
		}
		if (started > 2) return transactionHere(...args)
		return new Promise(function secondLater(resolve, reject) {
			runSecond = function startSecond() {
				transactionHere(...args).then(resolve, reject)
			}
			releaseSecond()
		})
	})
	return {
		restore: function restoreTransactions() {
			spy.mockRestore()
		},
		started: function transactionsStarted() {
			return started
		},
	}
}

describe('DexieStore - a request after an await, the zone of its transaction lost', () => {
	it('history status read → answered from its own transaction, never committed too early', async () => {
		const store = await seededStore()
		const zone = losingTheZoneFor(TABLE_CHANGELOG)
		try {
			const status = await settled(store.getHistoryStatus('a'))
			expect({ status, lost: zone.lost() }).toEqual({
				status: { answer: { canUndo: true, canRedo: false } },
				lost: true,
			})
		} finally {
			zone.restore()
		}
	})

	it('a commit → lands whole in its own transaction, never committed too early', async () => {
		const store = await seededStore()
		const zone = losingTheZoneFor(TABLE_CHANGELOG)
		let landed: unknown
		try {
			landed = await settled(
				store.commit({
					documentId: 'a',
					writeId: newCallId(),
					creates: [makeRecord({ id: 'r3' })],
					updates: [],
					deletes: [],
					onProgress: function ignoreProgress() {},
				}),
			)
		} finally {
			zone.restore()
		}
		const entries = await store.getChangeLog('a')
		expect({
			refused: 'thrown' in (landed as object),
			entries: entries.length,
			lost: zone.lost(),
		}).toEqual({
			refused: false,
			entries: 2,
			lost: true,
		})
	})
})

describe('DexieStore - two reads side by side, the second started in the zone of the first', () => {
	it('getMany and getByTagNameInDocument, the second once the first has ended → both answer', async () => {
		const store = await seededStore()
		const zones = secondInZoneOfFirst()
		try {
			const answers = await Promise.all([
				settled(store.getMany(['r1', 'r2'], 'a').then(idsOrNone)),
				settled(store.getByTagNameInDocument('A', 'a').then(idsOrNone)),
			])
			expect({ answers, started: zones.started() }).toEqual({
				answers: [{ answer: ['r1', 'r2'] }, { answer: ['r1', 'r2'] }],
				started: 2,
			})
		} finally {
			zones.restore()
		}
	})
})
