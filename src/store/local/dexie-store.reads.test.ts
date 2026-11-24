import { makeBlobEntry, makeRecord } from '../contract/store-contract.fixtures'
import { DexieStore } from './dexie-store'
import { holdNextOpen } from './dexie-store.connection.fixtures'
import { OPEN_LOCK_PREFIX } from './dexie-store.constants'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { newCallId } from '@/store/json-values'

import type { DocumentRecord } from '@/project'

// A read, or a write's registration check, while the store reloads its connection (an open after a close, the reload
// held at its registry read): it waits for the connection the reload makes, never reads the one it closed.

const opened: DexieStore[] = []
const names: string[] = []

afterEach(async () => {
	for (const store of opened.splice(0)) await store.close()
	for (const name of names.splice(0)) await Dexie.delete(name)
})

function documentOf(id: string): DocumentRecord {
	return { id, name: id, extension: '.xml', configKey: 'default', createdAt: 0, status: 'ready' }
}

/** A store of a new name holding document `a` with record `r1` and one commit. */
async function seededStore(): Promise<DexieStore> {
	const name = `dexie-reads-${crypto.randomUUID()}`
	names.push(name)
	const store = new DexieStore(name)
	opened.push(store)
	await store.open()
	await store.registerDocument(documentOf('a'))
	await store.bulkWrite('a', { creates: [makeRecord({ id: 'r1' })] })
	await store.commit({
		documentId: 'a',
		writeId: newCallId(),
		creates: [makeRecord({ id: 'r2' })],
		updates: [],
		deletes: [],
		onProgress: function ignoreProgress() {},
	})
	await store.addBlob(
		makeBlobEntry({
			id: 'blob-a',
			documentId: 'a',
			attachedTo: [{ documentId: 'a', recordRef: 'r1' }],
		}),
		new Blob(['a']),
	)
	return store
}

/** Settled once the reload is held; fails at once if the open settles (or fails) without holding one. */
function untilHeld(params: { reached: Promise<void>; reopening: Promise<void> }): Promise<void> {
	const { reached, reopening } = params
	return Promise.race([
		reached,
		reopening.then(function settledUnheld() {
			throw new Error('the open settled before its reload was held')
		}),
	])
}

/** What a write settles with: nothing when it lands, else its refusal's key (or text, for an error of no key). */
function refusalOf(write: Promise<unknown>): Promise<string | undefined> {
	return write.then(
		function landed() {
			return undefined
		},
		function refusalKey(thrown: unknown) {
			return toDialecteError(thrown)?.key ?? String(thrown)
		},
	)
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

function idOf(record: { id: string } | undefined): string | undefined {
	return record?.id
}

function idsOrNone(records: ReadonlyArray<{ id: string } | undefined>): (string | undefined)[] {
	return records.map(idOf)
}

function idsOf(records: ReadonlyArray<{ id: string }>): string[] {
	return records.map(function recordId(record) {
		return record.id
	})
}

describe('DexieStore - a read while its connection reloads', () => {
	it('reads started during an open after a close → each answers from the connection the reload makes', async () => {
		const store = await seededStore()
		await store.close()
		const hold = holdNextOpen({ store })
		try {
			const reopening = store.open()
			await untilHeld({ reached: hold.reached, reopening })
			// the old connection closed, the new one not made yet
			const reading = Promise.all([
				settled(store.get('r1', 'a').then(idOf)),
				settled(store.getByDocumentId('a').then(idsOf)),
				settled(store.count('a')),
				settled(store.getDocuments().then(idsOf)),
				settled(
					store.readVersion({ documentId: 'a' }).then(function moved(version) {
						return version.count > 0
					}),
				),
				settled(store.getHistoryStatus('a')),
				settled(
					store.getChangeLog('a').then(function entriesOf(entries) {
						return entries.length
					}),
				),
				settled(
					store.getBlob('blob-a').then(function blobId(blob) {
						return blob?.entry.id
					}),
				),
				settled(store.getBlobsByDocument('a').then(idsOf)),
				settled(store.getMany(['r2', 'none', 'r1'], 'a').then(idsOrNone)),
				settled(store.getByTagNameInDocument('A', 'a').then(idsOf)),
				settled(store.getDocument('a').then(idOf)),
				settled(store.getBlobsByRecord('a', 'r1').then(idsOf)),
				settled(store.getStandaloneBlobs().then(idsOf)),
			])
			hold.release()
			const [answers] = await Promise.all([reading, reopening])
			expect(answers).toEqual([
				{ answer: 'r1' },
				{ answer: ['r1', 'r2'] },
				{ answer: 2 },
				{ answer: ['a'] },
				{ answer: true },
				{ answer: { canUndo: true, canRedo: false } },
				{ answer: 1 },
				{ answer: 'blob-a' },
				{ answer: ['blob-a'] },
				{ answer: ['r2', undefined, 'r1'] },
				{ answer: ['r1', 'r2'] },
				{ answer: 'a' },
				{ answer: ['blob-a'] },
				{ answer: [] },
			])
		} finally {
			hold.restore()
		}
	})

	it('a write and a blob added to a document another connection registered while this store reloads → both land, never refused as not registered', async () => {
		const store = await seededStore()
		await store.close()
		const hold = holdNextOpen({ store })
		try {
			const reopening = store.open()
			await untilHeld({ reached: hold.reached, reopening })
			const other = new DexieStore(store.name)
			opened.push(other)
			await other.open()
			await other.registerDocument(documentOf('b'))
			// the reload not done: this store's table list is still the one before b
			const writing = settled(store.bulkWrite('b', { creates: [makeRecord({ id: 'b1' })] }))
			const adding = settled(
				store.addBlob(makeBlobEntry({ id: 'blob-b', documentId: 'b' }), new Blob(['b'])),
			)
			hold.release()
			const [outcome, added] = await Promise.all([writing, adding, reopening])
			const records = await store.getByDocumentId('b')
			const blob = await store.getBlob('blob-b')
			expect({ outcome, added, held: idsOf(records), blob: blob?.entry.id }).toEqual({
				outcome: { answer: undefined },
				added: { answer: undefined },
				held: ['b1'],
				blob: 'blob-b',
			})
		} finally {
			hold.restore()
		}
	})

	it('the connection probed and reconciled while an open makes it again → both wait for it: readable, open', async () => {
		const store = await seededStore()
		await store.close()
		const hold = holdNextOpen({ store })
		try {
			const reopening = store.open()
			await untilHeld({ reached: hold.reached, reopening })
			const readable = store.isDocumentReadable('a')
			const reconciled = store.reconcile().then(function openNow() {
				return store.getDatabaseInstance().isOpen()
			})
			hold.release()
			const [isReadable, isOpen] = await Promise.all([readable, reconciled, reopening])
			expect({ isReadable, isOpen }).toEqual({ isReadable: true, isOpen: true })
		} finally {
			hold.restore()
		}
	})

	it('a write while the open lock is held elsewhere → waits for the grant, then lands', async () => {
		const store = await seededStore()
		await store.close()
		const other = new DexieStore(store.name)
		opened.push(other)
		await other.open()
		await other.registerDocument(documentOf('b'))
		await other.close()
		// the open lock held alone: this store's open waits for its grant, its reload not queued yet
		const holding = Promise.withResolvers<void>()
		const releasing = Promise.withResolvers<void>()
		const exclusive = navigator.locks.request(
			`${OPEN_LOCK_PREFIX}${store.name}`,
			function holdAlone() {
				holding.resolve()
				return releasing.promise
			},
		)
		await holding.promise
		// the open's ask for the lock seen: by then the store counts open again, its reload not queued yet
		const asked = Promise.withResolvers<void>()
		const request = navigator.locks.request.bind(navigator.locks)
		try {
			navigator.locks.request = function seeTheAsk(...args: unknown[]) {
				if (args[0] === `${OPEN_LOCK_PREFIX}${store.name}`) asked.resolve()
				return (request as (...given: unknown[]) => Promise<unknown>)(...args)
			} as typeof navigator.locks.request
			const reopening = store.open()
			await asked.promise
			navigator.locks.request = request
			// the write waits for the open lock: it is granted once the holder lets it go
			const writing = settled(store.bulkWrite('b', { creates: [makeRecord({ id: 'b1' })] }))
			releasing.resolve()
			const [outcome] = await Promise.all([writing, exclusive, reopening])
			const records = await store.getByDocumentId('b')
			expect({ outcome, held: idsOf(records) }).toEqual({
				outcome: { answer: undefined },
				held: ['b1'],
			})
		} finally {
			navigator.locks.request = request
			releasing.resolve()
		}
	})

	it('a write on a store never opened, to a document another connection registered → lands, never refused as not registered', async () => {
		const seeded = await seededStore()
		await seeded.registerDocument(documentOf('b'))
		// a second store of the name, never opened: its connection holds no schema yet
		const fresh = new DexieStore(seeded.name)
		opened.push(fresh)
		const outcome = await settled(fresh.bulkWrite('b', { creates: [makeRecord({ id: 'b1' })] }))
		const records = await seeded.getByDocumentId('b')
		expect({ outcome, held: idsOf(records) }).toEqual({
			outcome: { answer: undefined },
			held: ['b1'],
		})
	})

	it('a write while a destroy elsewhere holds the open lock and deletes the database → refused DOCUMENT_NOT_REGISTERED, nothing written', async () => {
		const store = await seededStore()
		await store.close()
		// a destroy of another realm: the open lock held alone while the database is deleted
		const holding = Promise.withResolvers<void>()
		const releasing = Promise.withResolvers<void>()
		const destroying = navigator.locks.request(
			`${OPEN_LOCK_PREFIX}${store.name}`,
			function holdAlone() {
				holding.resolve()
				return releasing.promise
			},
		)
		await holding.promise
		const asked = Promise.withResolvers<void>()
		const request = navigator.locks.request.bind(navigator.locks)
		try {
			navigator.locks.request = function seeTheAsk(...args: unknown[]) {
				if (args[0] === `${OPEN_LOCK_PREFIX}${store.name}`) asked.resolve()
				return (request as (...given: unknown[]) => Promise<unknown>)(...args)
			} as typeof navigator.locks.request
			const reopening = store.open()
			await asked.promise
			navigator.locks.request = request
			const writing = refusalOf(store.bulkWrite('a', { creates: [makeRecord({ id: 'a9' })] }))
			await Dexie.delete(store.name)
			releasing.resolve()
			const [outcome] = await Promise.all([writing, destroying, reopening])
			const documents = await store.getDocuments()
			expect({ refusal: outcome, documents }).toEqual({
				refusal: 'DOCUMENT_NOT_REGISTERED',
				documents: [],
			})
		} finally {
			navigator.locks.request = request
			releasing.resolve()
		}
	})

	it('a write waiting for its open hold while this store’s own destroy runs → waits for the destroy, then refused DOCUMENT_NOT_REGISTERED', async () => {
		const seeded = await seededStore()
		await seeded.close()
		// a store of the name never opened: its write asks the open hold, which another holder keeps waiting
		const store = new DexieStore(seeded.name)
		opened.push(store)
		const holding = Promise.withResolvers<void>()
		const releasing = Promise.withResolvers<void>()
		const held = navigator.locks.request(`${OPEN_LOCK_PREFIX}${store.name}`, function holdAlone() {
			holding.resolve()
			return releasing.promise
		})
		await holding.promise
		const asked = Promise.withResolvers<void>()
		const request = navigator.locks.request.bind(navigator.locks)
		try {
			navigator.locks.request = function seeTheAsk(...args: unknown[]) {
				if (args[0] === `${OPEN_LOCK_PREFIX}${store.name}`) asked.resolve()
				return (request as (...given: unknown[]) => Promise<unknown>)(...args)
			} as typeof navigator.locks.request
			const writing = refusalOf(store.bulkWrite('a', { creates: [makeRecord({ id: 'a9' })] }))
			await asked.promise
			navigator.locks.request = request
			// its own destroy while the write waits: the write is not counted yet
			const destroying = store.destroy()
			releasing.resolve()
			const [refusal] = await Promise.all([writing, destroying, held])
			const after = new DexieStore(seeded.name)
			opened.push(after)
			await after.open()
			const documents = await after.getDocuments()
			expect({ refusal, documents }).toEqual({ refusal: 'DOCUMENT_NOT_REGISTERED', documents: [] })
		} finally {
			navigator.locks.request = request
			releasing.resolve()
		}
	})
})
