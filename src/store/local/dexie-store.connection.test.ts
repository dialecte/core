import { makeRecord } from '../contract/store-contract.fixtures'
import { DexieStore } from './dexie-store'
import { holdNextOpen } from './dexie-store.connection.fixtures'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { newCallId } from '@/store/json-values'

import type {
	ReloadPoint,
	StoreInternals,
	VersionchangeEvents,
} from './dexie-store.connection.types'
import type { DocumentRecord } from '@/project'

// A write whose store reloads its connection meanwhile (a second open of the store at once, a stale schema reloaded
// after another tab's import): the write lands, every table it writes through taken from the connection current
// when its transaction starts.

const opened: DexieStore[] = []
const names: string[] = []

afterEach(async () => {
	for (const store of opened.splice(0)) await store.close()
	for (const name of names.splice(0)) await Dexie.delete(name)
})

function documentOf(id: string): DocumentRecord {
	return { id, name: id, extension: '.xml', configKey: 'default', createdAt: 0, status: 'ready' }
}

/** A store of a new name holding document `a` with record `r1`. */
async function seededStore(): Promise<DexieStore> {
	const name = `dexie-connection-${crypto.randomUUID()}`
	names.push(name)
	const store = new DexieStore(name)
	opened.push(store)
	await store.open()
	await store.registerDocument(documentOf('a'))
	await store.bulkWrite('a', { creates: [makeRecord({ id: 'r1' })] })
	return store
}

/**
 * The store's connection reloaded once, right after `point` answers (`meanwhile` run first, as another connection's
 * work): the next step of the write meets a new one.
 */
function reloadAfter(params: {
	store: DexieStore
	point: ReloadPoint
	meanwhile?: () => Promise<void>
}): void {
	const { store, point, meanwhile } = params
	const internals = store as unknown as StoreInternals
	const original = internals[point].bind(store) as (...args: unknown[]) => Promise<unknown>
	let reloaded = false
	internals[point] = async function answerThenReload(...args: unknown[]) {
		const answer = await original(...args)
		if (!reloaded) {
			reloaded = true
			await meanwhile?.()
			await internals.reloadFromPersisted()
		}
		return answer
	} as never
}

function commitCreating(params: {
	store: DexieStore
	id: string
	documentId?: string
}): Promise<unknown> {
	const { store, id, documentId = 'a' } = params
	return store.commit({
		documentId,
		writeId: newCallId(),
		creates: [makeRecord({ id })],
		updates: [],
		deletes: [],
		onProgress: function ignoreProgress() {},
	})
}

/** The ids document `a` holds, read through a store of its own. */
async function idsHeld(params: { name: string }): Promise<string[]> {
	const reader = new DexieStore(params.name)
	opened.push(reader)
	await reader.open()
	const records = await reader.getByDocumentId('a')
	return records.map((record) => record.id)
}

/** What a write settles with: `landed`, or the refusal's text. */
function outcomeOf(write: Promise<unknown>): Promise<string> {
	return write.then(
		() => 'landed',
		(thrown: unknown) => String(thrown),
	)
}

describe('DexieStore - a write whose connection is reloaded meanwhile', () => {
	it('a commit, the connection reloaded between its table’s lookup and its write → lands', async () => {
		const store = await seededStore()
		reloadAfter({ store, point: 'writeTable' })
		const outcome = await outcomeOf(commitCreating({ store, id: 'r2' }))
		const held = await idsHeld({ name: store.name })
		expect({ outcome, held }).toEqual({ outcome: 'landed', held: ['r1', 'r2'] })
	})

	it('a bulk write, the connection reloaded between its table’s lookup and its write → lands', async () => {
		const store = await seededStore()
		reloadAfter({ store, point: 'writeTable' })
		const outcome = await outcomeOf(store.bulkWrite('a', { creates: [makeRecord({ id: 'r2' })] }))
		const held = await idsHeld({ name: store.name })
		expect({ outcome, held }).toEqual({ outcome: 'landed', held: ['r1', 'r2'] })
	})

	it('a commit, its document removed by another connection and the connection reloaded before its write → refused DOCUMENT_NOT_REGISTERED', async () => {
		const store = await seededStore()
		reloadAfter({
			store,
			point: 'writeTable',
			meanwhile: async function removeElsewhere() {
				const other = new DexieStore(store.name)
				opened.push(other)
				await other.open()
				await other.removeDocument('a')
			},
		})
		const thrown = await commitCreating({ store, id: 'r2' }).then(
			() => undefined,
			(refusal: unknown) => toDialecteError(refusal)?.key,
		)
		expect(thrown).toBe('DOCUMENT_NOT_REGISTERED')
	})
})

describe('DexieStore - a write while its connection closes or reloads', () => {
	it('a second open of an open store while a commit starts → its connection kept, never closed under the commit', async () => {
		const store = await seededStore()
		const hold = holdNextOpen({ store })
		try {
			// a reload, if the open makes one, held at its registry read: the old connection closed by then
			const reopening = store.open()
			await Promise.race([hold.reached, reopening])
			const committing = outcomeOf(commitCreating({ store, id: 'r2' }))
			// the commit runs its steps up to its transaction in microtasks; the held open needs the event loop
			hold.release()
			const [outcome] = await Promise.all([committing, reopening])
			const held = await idsHeld({ name: store.name })
			expect({ outcome, held }).toEqual({ outcome: 'landed', held: ['r1', 'r2'] })
		} finally {
			hold.restore()
		}
	})

	it('(pin) a commit whose connection a versionchange closes between its table’s lookup and its write → lands (Dexie reopens it, before and after)', async () => {
		const store = await seededStore()
		const internals = store as unknown as StoreInternals
		const original = internals.writeTable.bind(store)
		internals.writeTable = async function answerThenVersionchange(...args: unknown[]) {
			const answer = await original(...args)
			// what another tab's schema upgrade does to this connection
			const events = store.getDatabaseInstance().on as unknown as VersionchangeEvents
			events.versionchange.fire(new Event('versionchange'))
			return answer
		} as never
		const outcome = await outcomeOf(commitCreating({ store, id: 'r2' }))
		const held = await idsHeld({ name: store.name })
		expect({ outcome, held }).toEqual({ outcome: 'landed', held: ['r1', 'r2'] })
	})

	it('a commit whose connection closes as its transaction starts → run once more on the connection made again, landed once', async () => {
		const store = await seededStore()
		const original = Dexie.prototype.transaction
		let closed = false
		// the connection closed in the very step the write's transaction starts on it: what a reload taking the lock then does
		Dexie.prototype.transaction = function closeFirst(this: Dexie, ...args: unknown[]) {
			if (!closed && args[0] === 'rw' && this === store.getDatabaseInstance()) {
				closed = true
				this.close()
			}
			return (original as (...given: unknown[]) => unknown).apply(this, args)
		} as typeof Dexie.prototype.transaction
		try {
			const outcome = await outcomeOf(commitCreating({ store, id: 'r2' }))
			const held = await idsHeld({ name: store.name })
			const log = await store.getChangeLog('a')
			expect({ outcome, held, entries: log.length }).toEqual({
				outcome: 'landed',
				held: ['r1', 'r2'],
				entries: 1,
			})
		} finally {
			Dexie.prototype.transaction = original
		}
	})

	it('two undos of one document at once → two steps undone, never one twice', async () => {
		const store = await seededStore()
		await commitCreating({ store, id: 'r2' })
		await commitCreating({ store, id: 'r3' })
		const steps = await Promise.all([
			store.undo({ documentId: 'a', changeId: 'undo-1' }),
			store.undo({ documentId: 'a', changeId: 'undo-2' }),
		])
		const held = await idsHeld({ name: store.name })
		const status = await store.getHistoryStatus('a')
		expect({
			stepped: steps.filter((step) => step !== false).length,
			held,
			canUndo: status.canUndo,
		}).toEqual({ stepped: 2, held: ['r1'], canUndo: false })
	})

	it('two redos of one document at once → two steps redone, never one twice', async () => {
		const store = await seededStore()
		await commitCreating({ store, id: 'r2' })
		await commitCreating({ store, id: 'r3' })
		await store.undo({ documentId: 'a', changeId: 'undo-1' })
		await store.undo({ documentId: 'a', changeId: 'undo-2' })
		const steps = await Promise.all([
			store.redo({ documentId: 'a', changeId: 'redo-1' }),
			store.redo({ documentId: 'a', changeId: 'redo-2' }),
		])
		const held = await idsHeld({ name: store.name })
		const status = await store.getHistoryStatus('a')
		expect({
			stepped: steps.filter((step) => step !== false).length,
			held,
			canRedo: status.canRedo,
		}).toEqual({ stepped: 2, held: ['r1', 'r2', 'r3'], canRedo: false })
	})
})

describe('DexieStore - a write while a reload of its connection runs', () => {
	it('a commit started while an open after a close makes the connection again → waits for it and lands', async () => {
		const store = await seededStore()
		await store.close()
		const hold = holdNextOpen({ store })
		try {
			const reopening = store.open()
			// an open after a close always makes the connection again: its reload is what the case holds
			await hold.reached
			// the old connection closed, the new one not made yet: the commit waits for the reload under the lock
			const committing = outcomeOf(commitCreating({ store, id: 'r2' }))
			hold.release()
			const [outcome] = await Promise.all([committing, reopening])
			const held = await idsHeld({ name: store.name })
			expect({ outcome, held }).toEqual({ outcome: 'landed', held: ['r1', 'r2'] })
		} finally {
			hold.restore()
		}
	})

	it('(pin) a commit started while another document’s registration reopens the schema → waits for it and lands', async () => {
		const store = await seededStore()
		const hold = holdNextOpen({ store })
		try {
			const registering = store.registerDocument(documentOf('b'))
			await hold.reached
			const committing = outcomeOf(commitCreating({ store, id: 'r2' }))
			hold.release()
			const [outcome] = await Promise.all([committing, registering])
			const held = await idsHeld({ name: store.name })
			const documents = await store.getDocuments()
			expect({ outcome, held, documents: documents.map((document) => document.id) }).toEqual({
				outcome: 'landed',
				held: ['r1', 'r2'],
				documents: ['a', 'b'],
			})
		} finally {
			hold.restore()
		}
	})

	it('a commit waiting for a reload while another connection removes its document → refused DOCUMENT_NOT_REGISTERED', async () => {
		const store = await seededStore()
		const internals = store as unknown as StoreInternals
		const gate = Promise.withResolvers<void>()
		// the schema lock held, as by a reload under way: the commit waits for it
		const locked = internals.withSchemaLock(() => gate.promise)
		const committing = commitCreating({ store, id: 'r2' }).then(
			() => undefined,
			(refusal: unknown) => toDialecteError(refusal)?.key,
		)
		// the removal's schema upgrade sends this connection a versionchange: it is closed and made stale meanwhile
		const other = new DexieStore(store.name)
		opened.push(other)
		await other.open()
		await other.removeDocument('a')
		gate.resolve()
		await locked
		await expect(committing).resolves.toBe('DOCUMENT_NOT_REGISTERED')
	})
})
