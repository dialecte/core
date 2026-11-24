import { makeBlobEntry, makeRecord } from '../contract/store-contract.fixtures'
import { DexieStore } from './dexie-store'
import { holdNextOpen } from './dexie-store.connection.fixtures'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

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
			await hold.reached
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
			await hold.reached
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
})
