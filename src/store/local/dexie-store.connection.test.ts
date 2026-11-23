import { makeRecord } from '../contract/store-contract.fixtures'
import { DexieStore } from './dexie-store'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { newCallId } from '@/store/json-values'

import type { ReloadPoint, StoreInternals } from './dexie-store.connection.types'
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

function commitCreating(params: { store: DexieStore; id: string }): Promise<unknown> {
	const { store, id } = params
	return store.commit({
		documentId: 'a',
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

	// undo and redo took their tables right before their transaction already: this pins that they keep landing when the
	// head is read on the connection before a reload
	it('an undo, then a redo, the connection reloaded after each reads its head → each lands', async () => {
		const store = await seededStore()
		await commitCreating({ store, id: 'r2' })
		reloadAfter({ store, point: 'readHead' })
		const undone = await outcomeOf(store.undo({ documentId: 'a', changeId: 'undo-1' }))
		const afterUndo = await idsHeld({ name: store.name })
		reloadAfter({ store, point: 'readHead' })
		const redone = await outcomeOf(store.redo({ documentId: 'a', changeId: 'redo-1' }))
		const afterRedo = await idsHeld({ name: store.name })
		expect({ undone, afterUndo, redone, afterRedo }).toEqual({
			undone: 'landed',
			afterUndo: ['r1'],
			redone: 'landed',
			afterRedo: ['r1', 'r2'],
		})
	})
})
