import { contractFile, makeDocument, makeRecord } from './store-contract.fixtures'

import { expect, vi } from 'vitest'

import { newCallId } from '@/store/json-values'

import type { HistoryStep, Store, StoreNotice, StoreVersion } from '../store.types'
import type { StoreContractCases, StoreContractGroups } from './store-contract.types'
import type { ProjectChannelMessage } from '@/project/types'
import type { AnyRawRecord } from '@/types'

const DOCUMENT_ID = 'doc-1'

/** The document registered and holding one record, `r1`. */
async function seed(params: { store: Store }): Promise<void> {
	const { store } = params
	await store.registerDocument(makeDocument({ id: DOCUMENT_ID }))
	await store.bulkWrite(DOCUMENT_ID, { creates: [makeRecord({ id: 'r1' })] })
}

/** The document's version now, as the store answers it without a read. */
function versionNow(params: { store: Store; documentId?: string }): Promise<StoreVersion> {
	const { store, documentId = DOCUMENT_ID } = params
	// every store of the contract keeps a version
	expect(store.readVersion, 'the store reads a version').toBeTypeOf('function')
	return store.readVersion!({ documentId })
}

/** A commit creating `id`, and the version it answers. */
async function commitCreating(params: {
	store: Store
	id: string
	writeId?: string
}): Promise<StoreVersion | undefined> {
	const { store, id, writeId = newCallId() } = params
	const creates: AnyRawRecord[] = [makeRecord({ id })]
	const answer = await store.commit({
		documentId: DOCUMENT_ID,
		writeId,
		creates,
		updates: [],
		deletes: [],
		onProgress: function ignoreProgress() {},
	})
	return answer ? answer.version : undefined
}

/** The version an undo or a redo answered. */
function versionOfStep(params: { step: HistoryStep | false }): StoreVersion | undefined {
	return params.step === false ? undefined : params.step.version
}

/** The commit messages a store tells, in order. */
function commitsTold(params: {
	store: Store
}): Extract<ProjectChannelMessage, { type: 'commit' }>[] {
	const told: Extract<ProjectChannelMessage, { type: 'commit' }>[] = []
	params.store.subscribe!(function keep(notice: StoreNotice) {
		if (notice.type === 'change' && notice.message.type === 'commit') told.push(notice.message)
	})
	return told
}

const versions: StoreContractCases = {
	'a document never written → count 0': {
		act: async ({ store }) => {
			const version = await versionNow({ store, documentId: 'never-written' })
			expect(version.count).toBe(0)
		},
	},
	'a commit → the count moves by exactly one, the commit answers it, the version read right after is it':
		{
			act: async ({ store }) => {
				await seed({ store })
				const before = await versionNow({ store })
				const answered = await commitCreating({ store, id: 'r2' })
				const after = await versionNow({ store })
				expect(answered).toEqual({ engineId: before.engineId, count: before.count + 1 })
				expect(after).toEqual(answered)
			},
		},
	'an undo, then a redo → each moves the count by exactly one and answers it': {
		needs: ['history'],
		act: async ({ store }) => {
			await seed({ store })
			await commitCreating({ store, id: 'r2' })
			const before = await versionNow({ store })
			const undone = await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			const afterUndo = await versionNow({ store })
			const redone = await store.redo({ documentId: DOCUMENT_ID, changeId: 'redo-1' })
			const afterRedo = await versionNow({ store })
			expect({
				undone: versionOfStep({ step: undone }),
				afterUndo,
				redone: versionOfStep({ step: redone }),
				afterRedo,
			}).toEqual({
				undone: { engineId: before.engineId, count: before.count + 1 },
				afterUndo: { engineId: before.engineId, count: before.count + 1 },
				redone: { engineId: before.engineId, count: before.count + 2 },
				afterRedo: { engineId: before.engineId, count: before.count + 2 },
			})
		},
	},
	'a removal → the count moves by exactly one; the id registered again goes on from it': {
		act: async ({ store }) => {
			await seed({ store })
			const before = await versionNow({ store })
			await store.removeDocument(DOCUMENT_ID)
			const removed = await versionNow({ store })
			await store.registerDocument(makeDocument({ id: DOCUMENT_ID }))
			const registered = await versionNow({ store })
			expect(removed).toEqual({ engineId: before.engineId, count: before.count + 1 })
			expect(registered).toEqual(removed)
		},
	},
	'a bulk write → the count moves on': {
		act: async ({ store }) => {
			await seed({ store })
			const before = await versionNow({ store })
			await store.bulkWrite(DOCUMENT_ID, { creates: [makeRecord({ id: 'r2' })] })
			const after = await versionNow({ store })
			expect(after.engineId).toBe(before.engineId)
			expect(after.count).toBeGreaterThan(before.count)
		},
	},
	'an import → its document’s count moved on from 0': {
		needs: ['import'],
		act: async ({ store }) => {
			const { record } = await store.importFile({ file: contractFile({ body: '<B aB="B0"/>' }) })
			const version = await versionNow({ store, documentId: record.id })
			expect(version.count).toBeGreaterThan(0)
		},
	},
	'a write of one document → another document’s version unchanged': {
		act: async ({ store }) => {
			await seed({ store })
			await store.registerDocument(makeDocument({ id: 'doc-2' }))
			const before = await versionNow({ store, documentId: 'doc-2' })
			await commitCreating({ store, id: 'r2' })
			const after = await versionNow({ store, documentId: 'doc-2' })
			expect(after).toEqual(before)
		},
	},
	'the version read with a versioned read → the version read alone': {
		needs: ['versioned-read'],
		act: async ({ store }) => {
			await seed({ store })
			await commitCreating({ store, id: 'r2' })
			const alone = await versionNow({ store })
			const withRead = await store.readVersioned!({
				documentId: DOCUMENT_ID,
				read: { member: 'get', args: ['r1', DOCUMENT_ID] },
			})
			expect(withRead.version).toEqual(alone)
		},
	},
	'two connections to one store → the same engine id, a write of one read by the other': {
		needs: ['second-connection'],
		act: async ({ store, connect }) => {
			await seed({ store })
			const other = await connect()
			const answered = await commitCreating({ store: other, id: 'r2' })
			const read = await versionNow({ store })
			expect(read).toEqual(answered)
		},
	},
	'the store opened again → the same engine id, the count where it was': {
		needs: ['engine-restart'],
		act: async ({ store, reopen }) => {
			await seed({ store })
			const before = await versionNow({ store })
			const reopened = await reopen()
			const after = await versionNow({ store: reopened })
			expect(after).toEqual(before)
		},
	},
	'a commit refused, an undo and a redo with nothing to step → the count unchanged': {
		needs: ['history'],
		act: async ({ store }) => {
			await seed({ store })
			const before = await versionNow({ store })
			// r1 is held: the commit creating it again is refused
			const refused = await commitCreating({ store, id: 'r1' }).then(
				() => 'committed',
				() => 'refused',
			)
			const undone = await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-none' })
			const redone = await store.redo({ documentId: DOCUMENT_ID, changeId: 'redo-none' })
			const after = await versionNow({ store })
			expect({ refused, undone, redone, after }).toEqual({
				refused: 'refused',
				undone: false,
				redone: false,
				after: before,
			})
		},
	},
	'the store destroyed and made again → another engine id': {
		act: async ({ store, reopen }) => {
			await seed({ store })
			const before = await versionNow({ store })
			await store.destroy()
			const remade = await reopen()
			await seed({ store: remade })
			const after = await versionNow({ store: remade })
			expect(after.engineId).not.toBe(before.engineId)
		},
	},
	'its engine ended, the store opened again → another engine id': {
		needs: ['engine-end'],
		act: async ({ store, reopen, endEngine }) => {
			await seed({ store })
			const before = await versionNow({ store })
			await endEngine()
			const reopened = await reopen()
			const after = await versionNow({ store: reopened })
			expect(after.engineId).not.toBe(before.engineId)
		},
	},
	'a commit, an undo, a redo told → each message carries the version its write answered': {
		needs: ['history', 'announce'],
		act: async ({ store }) => {
			await seed({ store })
			const told = commitsTold({ store })
			const committed = await commitCreating({ store, id: 'r2', writeId: 'w-told' })
			const undone = await store.undo({ documentId: DOCUMENT_ID, changeId: 'undo-told' })
			const redone = await store.redo({ documentId: DOCUMENT_ID, changeId: 'redo-told' })
			expect(committed, 'the commit answers its version').toBeDefined()
			await vi.waitFor(function allTold() {
				expect(told.map((message) => [message.changeId, message.version])).toEqual([
					['w-told', committed],
					['undo-told', versionOfStep({ step: undone })],
					['redo-told', versionOfStep({ step: redone })],
				])
			})
		},
	},
}

/** One version per document, read without a record, moved by one per write: on every store and every link. */
export const STORE_VERSIONS_CONTRACT: StoreContractGroups = {
	versions,
}
