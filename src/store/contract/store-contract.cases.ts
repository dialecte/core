import {
	childRef,
	commit,
	expectRejectsWith,
	makeBlobEntry,
	makeDocument,
	makeRecord,
} from './store-contract.fixtures'

import { expect } from 'vitest'

import type { Store } from '../store.types'
import type {
	AbsentDocumentRead,
	AttributePatchCase,
	SiblingOrderStep,
	StoreContractCases,
	StoreContractContext,
	StoreContractGroups,
} from './store-contract.types'
import type { DocumentRecord } from '@/project/types'

// ── Lifecycle ────────────────────────────────────────────────────────────────

const lifecycle: StoreContractCases = {
	'open and close do not throw, open twice is fine': {
		act: async ({ store }) => {
			await expect(store.open()).resolves.toBeUndefined()
			expect(() => store.close()).not.toThrow()
			await expect(store.open()).resolves.toBeUndefined()
		},
	},
	'destroy removes everything: the same name reopens empty': {
		act: async ({ store, reopen }) => {
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			await store.destroy()
			const reopened = await reopen()
			expect(await reopened.getDocuments()).toEqual([])
		},
	},
}

// ── Document registry ────────────────────────────────────────────────────────

const documentUpdates: Record<
	string,
	Partial<Pick<DocumentRecord, 'name' | 'metadata' | 'status' | 'importingAt'>>
> = {
	name: { name: 'renamed' },
	metadata: { metadata: { origin: 'test' } },
	status: { status: 'importing' },
	importingAt: { importingAt: 42 },
}

const registry: StoreContractCases = {
	'registers and retrieves a document as given': {
		act: async ({ store }) => {
			const document = makeDocument({ metadata: { origin: 'test' } })
			await store.registerDocument(document)
			expect(await store.getDocument('doc-1')).toEqual(document)
		},
	},
	'lists every registered document': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: 'a' }))
			await store.registerDocument(makeDocument({ id: 'b' }))
			const documents = await store.getDocuments()
			expect(documents.map((document) => document.id).sort()).toEqual(['a', 'b'])
		},
	},
	'an unknown document reads undefined': {
		act: async ({ store }) => {
			expect(await store.getDocument('nope')).toBeUndefined()
		},
	},
	...Object.fromEntries(
		Object.entries(documentUpdates).map(([field, updates]) => [
			`updateDocument changes ${field} and nothing else`,
			{
				act: async ({ store }: StoreContractContext) => {
					const document = makeDocument()
					await store.registerDocument(document)
					await store.updateDocument('doc-1', updates)
					expect(await store.getDocument('doc-1')).toEqual({ ...document, ...updates })
				},
			},
		]),
	),
	'removes a document: gone from the registry, its records unreadable': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			await store.removeDocument('doc-1')
			expect(await store.getDocument('doc-1')).toBeUndefined()
			expect(await store.getDocuments()).toEqual([])
			expect(await store.getByDocumentId('doc-1')).toEqual([])
		},
	},
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function seedTwoRecords(store: Store): Promise<void> {
	await store.registerDocument(makeDocument())
	await store.bulkWrite('doc-1', {
		creates: [makeRecord({ id: 'r1', tagName: 'LNode' }), makeRecord({ id: 'r2', tagName: 'Bay' })],
	})
}

const reads: StoreContractCases = {
	'get by id within a document': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			expect((await store.get('r1', 'doc-1'))?.id).toBe('r1')
		},
	},
	'get by id across documents when no document is given': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			expect((await store.get('r1'))?.id).toBe('r1')
		},
	},
	'an unknown id reads undefined': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			expect(await store.get('nope', 'doc-1')).toBeUndefined()
			expect(await store.get('nope')).toBeUndefined()
		},
	},
	'getByDocumentId returns every record of the document': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			const records = await store.getByDocumentId('doc-1')
			expect(records.map((record) => record.id).sort()).toEqual(['r1', 'r2'])
		},
	},
	'count is the number of records of the document': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			expect(await store.count('doc-1')).toBe(0)
			await store.bulkWrite('doc-1', {
				creates: [makeRecord({ id: 'r1' }), makeRecord({ id: 'r2' })],
			})
			expect(await store.count('doc-1')).toBe(2)
		},
	},
	'getByTagNameInDocument keeps the records of that tag only': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r3', tagName: 'LNode' })] })
			const records = await store.getByTagNameInDocument('LNode', 'doc-1')
			expect(records.map((record) => record.id).sort()).toEqual(['r1', 'r3'])
		},
	},
	'getMany answers in the order asked, undefined for a missing id': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			const records = await store.getMany(['r2', 'nope', 'r1'], 'doc-1')
			expect(records.map((record) => record?.id)).toEqual(['r2', undefined, 'r1'])
		},
	},
	'records are isolated between documents': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: 'a' }))
			await store.registerDocument(makeDocument({ id: 'b' }))
			await store.bulkWrite('a', { creates: [makeRecord({ id: 'ra', tagName: 'Bay' })] })
			await store.bulkWrite('b', { creates: [makeRecord({ id: 'rb', tagName: 'Bay' })] })
			expect((await store.getByDocumentId('a')).map((record) => record.id)).toEqual(['ra'])
			expect((await store.getByDocumentId('b')).map((record) => record.id)).toEqual(['rb'])
			expect(await store.get('ra', 'b')).toBeUndefined()
			expect(await store.getByTagNameInDocument('Bay', 'a')).toHaveLength(1)
		},
	},
}

// ── Bulk writes ──────────────────────────────────────────────────────────────

const attributePatches: Record<string, AttributePatchCase> = {
	'record with aA and bA, patch removes aA -> bA kept, aA gone': {
		attributes: [
			{ name: 'aA', value: 'a' },
			{ name: 'bA', value: 'b' },
		],
		patch: { removeAttributes: ['aA'] },
		expectedAttributes: [{ name: 'bA', value: 'b' }],
	},
	'record without aA, patch removes aA -> attributes unchanged': {
		attributes: [{ name: 'bA', value: 'b' }],
		patch: { removeAttributes: ['aA'] },
		expectedAttributes: [{ name: 'bA', value: 'b' }],
	},
	'patch sets bA and removes aA -> bA updated, aA gone': {
		attributes: [
			{ name: 'aA', value: 'a' },
			{ name: 'bA', value: 'b' },
		],
		patch: { attributes: [{ name: 'bA', value: 'B' }], removeAttributes: ['aA'] },
		expectedAttributes: [{ name: 'bA', value: 'B' }],
	},
	'patch sets and removes aA -> aA gone, removal applies after the merge': {
		attributes: [{ name: 'aA', value: 'a' }],
		patch: { attributes: [{ name: 'aA', value: 'A' }], removeAttributes: ['aA'] },
		expectedAttributes: [],
	},
	'patch removes aA with attributes given as undefined -> aA gone, bA kept': {
		attributes: [
			{ name: 'aA', value: 'a' },
			{ name: 'bA', value: 'b' },
		],
		patch: { attributes: undefined, removeAttributes: ['aA'] },
		expectedAttributes: [{ name: 'bA', value: 'b' }],
	},
	'patch sets cA on a record with aA -> cA appended, aA kept': {
		attributes: [{ name: 'aA', value: 'a' }],
		patch: { attributes: [{ name: 'cA', value: 'c' }] },
		expectedAttributes: [
			{ name: 'aA', value: 'a' },
			{ name: 'cA', value: 'c' },
		],
	},
}

const bulkWrites: StoreContractCases = {
	'creates land as given': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			const record = makeRecord({ id: 'r1', value: 'text', children: [{ id: 'c1', tagName: 'B' }] })
			await store.bulkWrite('doc-1', { creates: [record] })
			expect(await store.get('r1', 'doc-1')).toEqual(record)
		},
	},
	...Object.fromEntries(
		Object.entries(attributePatches).map(([description, patchCase]) => [
			`update patch: ${description}`,
			{
				act: async ({ store }: StoreContractContext) => {
					await store.registerDocument(makeDocument())
					await store.bulkWrite('doc-1', {
						creates: [makeRecord({ id: 'r1', attributes: patchCase.attributes })],
					})
					await store.bulkWrite('doc-1', { updates: [{ recordId: 'r1', ...patchCase.patch }] })
					const stored = await store.get('r1', 'doc-1')
					expect(stored?.attributes).toEqual(patchCase.expectedAttributes)
					expect(stored).not.toHaveProperty('removeAttributes')
				},
			},
		]),
	),
	'update patch: a listed child replaces the one with its id, a new child is appended': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', {
				creates: [
					makeRecord({
						id: 'p',
						children: [
							{ id: 'c1', tagName: 'B' },
							{ id: 'c2', tagName: 'B' },
						],
					}),
				],
			})
			await store.bulkWrite('doc-1', {
				updates: [
					{
						recordId: 'p',
						children: [
							{ id: 'c3', tagName: 'B' },
							{ id: 'c1', tagName: 'C' },
						],
					},
				],
			})
			expect((await store.get('p', 'doc-1'))?.children).toEqual([
				{ id: 'c1', tagName: 'C' },
				{ id: 'c2', tagName: 'B' },
				{ id: 'c3', tagName: 'B' },
			])
		},
	},
	'update patch: scalar fields replace, the others stay': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1', value: 'old' })] })
			await store.bulkWrite('doc-1', { updates: [{ recordId: 'r1', value: 'new', tagName: 'Z' }] })
			expect(await store.get('r1', 'doc-1')).toEqual(
				makeRecord({ id: 'r1', value: 'new', tagName: 'Z' }),
			)
		},
	},
	'update patch of an absent record changes nothing': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { updates: [{ recordId: 'nope', value: 'new' }] })
			expect(await store.getByDocumentId('doc-1')).toEqual([])
		},
	},
	'deletes remove the records, an absent id is ignored': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await store.bulkWrite('doc-1', { deletes: ['r1', 'nope'] })
			expect((await store.getByDocumentId('doc-1')).map((record) => record.id)).toEqual(['r2'])
		},
	},
	'leaves no history: bulk writes are not undoable': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			expect(await store.getChangeLog('doc-1')).toEqual([])
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: false, canRedo: false })
			await store.undo('doc-1')
			expect(await store.count('doc-1')).toBe(2)
		},
	},
}

// ── Commit and history ───────────────────────────────────────────────────────

const history: StoreContractCases = {
	'commit creates records': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r1' })] })
			expect(await store.get('r1', 'doc-1')).toEqual(makeRecord({ id: 'r1' }))
		},
	},
	'commit updates records whole': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			const updated = makeRecord({ id: 'r1', tagName: 'VoltageLevel', attributes: [] })
			await commit({ store, documentId: 'doc-1', updates: [updated] })
			expect(await store.get('r1', 'doc-1')).toEqual(updated)
		},
	},
	'commit deletes records': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await commit({ store, documentId: 'doc-1', deletes: ['r1'] })
			expect(await store.get('r1', 'doc-1')).toBeUndefined()
			expect(await store.count('doc-1')).toBe(1)
		},
	},
	'commit reports progress up to the number of operations': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			const reported: [number, number][] = []
			await store.commit({
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'r3' })],
				updates: [makeRecord({ id: 'r1', value: 'v' })],
				deletes: ['r2'],
				onProgress: (current, total) => reported.push([current, total]),
			})
			expect(reported.at(-1)).toEqual([3, 3])
			expect(reported.every(([current, total]) => current <= total)).toBe(true)
		},
	},
	'undo reverts the last commit: creates gone, updates back, deletes back': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await commit({
				store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'r3' })],
				updates: [makeRecord({ id: 'r1', value: 'v' })],
				deletes: ['r2'],
			})
			await store.undo('doc-1')
			expect(await store.get('r3', 'doc-1')).toBeUndefined()
			expect(await store.get('r1', 'doc-1')).toEqual(makeRecord({ id: 'r1', tagName: 'LNode' }))
			expect(await store.get('r2', 'doc-1')).toEqual(makeRecord({ id: 'r2', tagName: 'Bay' }))
		},
	},
	'redo re-applies an undone commit': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await commit({
				store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'r3' })],
				updates: [makeRecord({ id: 'r1', value: 'v' })],
				deletes: ['r2'],
			})
			await store.undo('doc-1')
			await store.redo('doc-1')
			expect(await store.get('r3', 'doc-1')).toEqual(makeRecord({ id: 'r3' }))
			expect((await store.get('r1', 'doc-1'))?.value).toBe('v')
			expect(await store.get('r2', 'doc-1')).toBeUndefined()
		},
	},
	'undo at the start of history is a no-op': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await expect(store.undo('doc-1')).resolves.toBeUndefined()
		},
	},
	'redo at the end of history is a no-op': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r1' })] })
			await expect(store.redo('doc-1')).resolves.toBeUndefined()
			expect(await store.count('doc-1')).toBe(1)
		},
	},
	'history status follows commit, undo and redo': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: false, canRedo: false })
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r1' })] })
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: true, canRedo: false })
			await store.undo('doc-1')
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: false, canRedo: true })
			await store.redo('doc-1')
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: true, canRedo: false })
		},
	},
	'a commit after an undo drops the redo future': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r1' })] })
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r2' })] })
			await store.undo('doc-1')
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r3' })] })
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: true, canRedo: false })
			const log = await store.getChangeLog('doc-1')
			expect(log.map((entry) => entry.operations.creates[0]?.id)).toEqual(['r1', 'r3'])
			await store.redo('doc-1')
			expect(await store.get('r2', 'doc-1')).toBeUndefined()
		},
	},
	'count follows every write: bulk write, commit, undo, redo, remove': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			expect(await store.count('doc-1'), 'empty').toBe(0)
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			expect(await store.count('doc-1'), 'after a bulk write').toBe(1)
			await commit({
				store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'r2' }), makeRecord({ id: 'r3' })],
			})
			expect(await store.count('doc-1'), 'after a commit creating two').toBe(3)
			await commit({ store, documentId: 'doc-1', deletes: ['r1'] })
			expect(await store.count('doc-1'), 'after a commit deleting one').toBe(2)
			await store.undo('doc-1')
			expect(await store.count('doc-1'), 'after undoing the delete').toBe(3)
			await store.redo('doc-1')
			expect(await store.count('doc-1'), 'after redoing it').toBe(2)
			await store.removeDocument('doc-1')
			await store.registerDocument(makeDocument())
			expect(await store.count('doc-1'), 'after removing the document').toBe(0)
		},
	},
	'getChangeLog lists the entries of the document in sequence order': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r1' })] })
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r2' })] })
			const log = await store.getChangeLog('doc-1')
			expect(log.map((entry) => entry.sequenceNumber)).toEqual([1, 2])
			expect(log.every((entry) => entry.documentId === 'doc-1')).toBe(true)
			expect(log[0].operations.creates.map((record) => record.id)).toEqual(['r1'])
		},
	},
	'history is document-scoped': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: 'a' }))
			await store.registerDocument(makeDocument({ id: 'b' }))
			await commit({ store, documentId: 'a', creates: [makeRecord({ id: 'ra' })] })
			await commit({ store, documentId: 'b', creates: [makeRecord({ id: 'rb' })] })
			expect(await store.getChangeLog('a')).toHaveLength(1)
			expect(await store.getChangeLog('b')).toHaveLength(1)
			await store.undo('a')
			expect(await store.get('rb', 'b')).toBeDefined()
			expect(await store.getHistoryStatus('b')).toEqual({ canUndo: true, canRedo: false })
		},
	},
}

// ── Reopen ───────────────────────────────────────────────────────────────────

const reopen: StoreContractCases = {
	'documents and records are there again after a reopen': {
		act: async ({ store, reopen }) => {
			await seedTwoRecords(store)
			const reopened = await reopen()
			expect((await reopened.getDocuments()).map((document) => document.id)).toEqual(['doc-1'])
			expect((await reopened.getByDocumentId('doc-1')).map((record) => record.id).sort()).toEqual([
				'r1',
				'r2',
			])
		},
	},
	'history is there again after a reopen: undo still works': {
		act: async ({ store, reopen }) => {
			await store.registerDocument(makeDocument())
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r1' })] })
			const reopened = await reopen()
			expect(await reopened.getHistoryStatus('doc-1')).toEqual({ canUndo: true, canRedo: false })
			await reopened.undo('doc-1')
			expect(await reopened.get('r1', 'doc-1')).toBeUndefined()
		},
	},
}

// ── Blobs ────────────────────────────────────────────────────────────────────

async function seedTwoDocuments(store: Store): Promise<void> {
	await store.registerDocument(makeDocument({ id: 'doc-1' }))
	await store.registerDocument(makeDocument({ id: 'doc-2' }))
}

const blobs: StoreContractCases = {
	'addBlob + getBlob round-trip keeps entry and data': {
		act: async ({ store }) => {
			await seedTwoDocuments(store)
			const entry = makeBlobEntry({ name: 'a.txt' })
			await store.addBlob(entry, new Blob(['hello'], { type: 'text/plain' }))
			const result = await store.getBlob(entry.id)
			expect(result?.entry).toEqual(entry)
			expect(await result?.data.text()).toBe('hello')
		},
	},
	'addBlob is rejected when the owner document is not registered': {
		act: async ({ store }) => {
			await seedTwoDocuments(store)
			await expectRejectsWith({
				action: store.addBlob(makeBlobEntry({ documentId: 'missing' }), new Blob(['x'])),
				key: 'DOCUMENT_NOT_REGISTERED',
				meta: { documentId: 'missing' },
			})
		},
	},
	'an unknown blob reads undefined': {
		act: async ({ store }) => {
			expect(await store.getBlob('nope')).toBeUndefined()
		},
	},
	'getBlobsByDocument filters by attachedTo, not by the owner': {
		act: async ({ store }) => {
			await seedTwoDocuments(store)
			await store.addBlob(
				makeBlobEntry({ id: 'b1', attachedTo: [{ documentId: 'doc-2', recordRef: 'r1' }] }),
				new Blob(['1']),
			)
			await store.addBlob(makeBlobEntry({ id: 'b2' }), new Blob(['2']))
			expect((await store.getBlobsByDocument('doc-2')).map((blob) => blob.id)).toEqual(['b1'])
			expect(await store.getBlobsByDocument('doc-1')).toEqual([])
		},
	},
	'getBlobsByRecord filters on documentId + recordRef': {
		act: async ({ store }) => {
			await seedTwoDocuments(store)
			await store.addBlob(
				makeBlobEntry({
					id: 'b1',
					attachedTo: [
						{ documentId: 'doc-2', recordRef: 'r1' },
						{ documentId: 'doc-2', recordRef: 'r2' },
					],
				}),
				new Blob(['x']),
			)
			expect((await store.getBlobsByRecord('doc-2', 'r1')).map((blob) => blob.id)).toEqual(['b1'])
			expect(await store.getBlobsByRecord('doc-2', 'r3')).toEqual([])
		},
	},
	'getStandaloneBlobs returns the blobs attached to nothing': {
		act: async ({ store }) => {
			await seedTwoDocuments(store)
			await store.addBlob(makeBlobEntry({ id: 'b1' }), new Blob(['1']))
			await store.addBlob(
				makeBlobEntry({ id: 'b2', attachedTo: [{ documentId: 'doc-2', recordRef: 'r1' }] }),
				new Blob(['2']),
			)
			expect((await store.getStandaloneBlobs()).map((blob) => blob.id)).toEqual(['b1'])
		},
	},
	'attachBlob is idempotent on an identical ref': {
		act: async ({ store }) => {
			await seedTwoDocuments(store)
			await store.addBlob(makeBlobEntry({ id: 'b1' }), new Blob(['x']))
			const ref = { documentId: 'doc-2', recordRef: 'r1' }
			await store.attachBlob('b1', ref)
			await store.attachBlob('b1', ref)
			expect((await store.getBlob('b1'))?.entry.attachedTo).toEqual([ref])
		},
	},
	'attachBlob and detachBlob of an unknown blob are rejected': {
		act: async ({ store }) => {
			await expectRejectsWith({
				action: store.attachBlob('nope', { documentId: 'd', recordRef: 'r' }),
				key: 'STORE_BLOB_NOT_FOUND',
			})
			await expectRejectsWith({
				action: store.detachBlob('nope', { documentId: 'd', recordRef: 'r' }),
				key: 'STORE_BLOB_NOT_FOUND',
			})
		},
	},
	'detachBlob removes every ref matching documentId + recordRef': {
		act: async ({ store }) => {
			await seedTwoDocuments(store)
			await store.addBlob(
				makeBlobEntry({
					id: 'b1',
					attachedTo: [
						{ documentId: 'doc-2', recordRef: 'r1', attribute: 'a1' },
						{ documentId: 'doc-2', recordRef: 'r1', attribute: 'a2' },
						{ documentId: 'doc-2', recordRef: 'r2' },
					],
				}),
				new Blob(['x']),
			)
			await store.detachBlob('b1', { documentId: 'doc-2', recordRef: 'r1' })
			expect((await store.getBlob('b1'))?.entry.attachedTo).toEqual([
				{ documentId: 'doc-2', recordRef: 'r2' },
			])
		},
	},
	'removeBlob removes the entry and its data; an unknown blob is ignored': {
		act: async ({ store }) => {
			await seedTwoDocuments(store)
			await store.addBlob(makeBlobEntry({ id: 'b1' }), new Blob(['x']))
			await store.removeBlob('b1')
			await expect(store.removeBlob('b1')).resolves.toBeUndefined()
			expect(await store.getBlob('b1')).toBeUndefined()
			expect(await store.getStandaloneBlobs()).toEqual([])
		},
	},
	'removeDocument cascades: the blobs it owns go, the others stay': {
		act: async ({ store }) => {
			await seedTwoDocuments(store)
			await store.addBlob(makeBlobEntry({ id: 'b1', documentId: 'doc-1' }), new Blob(['1']))
			await store.addBlob(makeBlobEntry({ id: 'b2', documentId: 'doc-2' }), new Blob(['2']))
			await store.removeDocument('doc-1')
			expect(await store.getBlob('b1')).toBeUndefined()
			expect((await store.getBlob('b2'))?.entry.id).toBe('b2')
		},
	},
}

// ── Sibling order ────────────────────────────────────────────────────────────

/** A parent `p` whose children are the given ids, in that order, each one a record of the document. */
async function seedParentWithChildren(params: { store: Store; childIds: string[] }): Promise<void> {
	const { store, childIds } = params
	await store.registerDocument(makeDocument())
	await store.bulkWrite('doc-1', {
		creates: [
			makeRecord({ id: 'p', children: childIds.map((id) => childRef(id)) }),
			...childIds.map((id) => makeRecord({ id, parent: childRef('p') })),
		],
	})
}

/** The parent as every read path returns it; the order of its children must agree everywhere. */
async function childrenOfParent(store: Store): Promise<string[][]> {
	const byGet = await store.get('p', 'doc-1')
	const [byGetMany] = await store.getMany(['p'], 'doc-1')
	const byDocument = (await store.getByDocumentId('doc-1')).find((record) => record.id === 'p')
	const byTag = (await store.getByTagNameInDocument('A', 'doc-1')).find(
		(record) => record.id === 'p',
	)
	return [byGet, byGetMany, byDocument, byTag].map(
		(parent) => parent?.children.map((child) => child.id) ?? [],
	)
}

const bBetweenCAndA = makeRecord({ id: 'p', children: ['c', 'b', 'a'].map((id) => childRef(id)) })

const siblingOrderSteps: Record<string, SiblingOrderStep> = {
	'a bulk write keeps the order written, not the id order': {
		run: async ({ store }) => seedParentWithChildren({ store, childIds: ['c', 'a', 'b'] }),
		expected: ['c', 'a', 'b'],
	},
	'a commit creating b between c and a': {
		run: async ({ store }) => {
			await seedParentWithChildren({ store, childIds: ['c', 'a'] })
			await commit({
				store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'b' })],
				updates: [bBetweenCAndA],
			})
		},
		expected: ['c', 'b', 'a'],
	},
	'a commit reordering the children': {
		run: async ({ store }) => {
			await seedParentWithChildren({ store, childIds: ['a', 'b', 'c'] })
			await commit({
				store,
				documentId: 'doc-1',
				updates: [makeRecord({ id: 'p', children: ['c', 'b', 'a'].map((id) => childRef(id)) })],
			})
		},
		expected: ['c', 'b', 'a'],
	},
	'a commit deleting b': {
		run: async ({ store }) => {
			await seedParentWithChildren({ store, childIds: ['c', 'b', 'a'] })
			await commit({
				store,
				documentId: 'doc-1',
				updates: [makeRecord({ id: 'p', children: ['c', 'a'].map((id) => childRef(id)) })],
				deletes: ['b'],
			})
		},
		expected: ['c', 'a'],
	},
	'an undo of the create between': {
		run: async ({ store }) => {
			await seedParentWithChildren({ store, childIds: ['c', 'a'] })
			await commit({
				store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'b' })],
				updates: [bBetweenCAndA],
			})
			await store.undo('doc-1')
		},
		expected: ['c', 'a'],
	},
	'a redo of the create between': {
		run: async ({ store }) => {
			await seedParentWithChildren({ store, childIds: ['c', 'a'] })
			await commit({
				store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'b' })],
				updates: [bBetweenCAndA],
			})
			await store.undo('doc-1')
			await store.redo('doc-1')
		},
		expected: ['c', 'b', 'a'],
	},
	'a reopen after the create between': {
		run: async (context) => {
			await seedParentWithChildren({ store: context.store, childIds: ['c', 'a'] })
			await commit({
				store: context.store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'b' })],
				updates: [bBetweenCAndA],
			})
			await context.reopen()
		},
		expected: ['c', 'b', 'a'],
	},
}

const siblingOrder: StoreContractCases = Object.fromEntries(
	Object.entries(siblingOrderSteps).map(([description, step]) => [
		`children keep their order through ${description}`,
		{
			act: async (context: StoreContractContext) => {
				await step.run(context)
				const seen = await childrenOfParent(context.store)
				expect(seen, 'get, getMany, getByDocumentId, getByTagNameInDocument').toEqual([
					step.expected,
					step.expected,
					step.expected,
					step.expected,
				])
			},
		},
	]),
)

// ── Changelog snapshots ──────────────────────────────────────────────────────

const snapshots: StoreContractCases = {
	'an update entry carries the whole record before and after, children included': {
		act: async ({ store }) => {
			await seedParentWithChildren({ store, childIds: ['a', 'b', 'c'] })
			const before = makeRecord({ id: 'p', children: ['a', 'b', 'c'].map((id) => childRef(id)) })
			const after = makeRecord({
				id: 'p',
				children: ['c', 'a'].map((id) => childRef(id)),
				attributes: [{ name: 'a', value: '2' }],
			})
			await commit({ store, documentId: 'doc-1', updates: [after], deletes: ['b'] })
			const [entry] = await store.getChangeLog('doc-1')
			expect(entry.operations.updates).toEqual([{ before, after }])
		},
	},
	'a delete entry carries the whole record deleted': {
		act: async ({ store }) => {
			await seedParentWithChildren({ store, childIds: ['a', 'b'] })
			await commit({ store, documentId: 'doc-1', deletes: ['a'] })
			const [entry] = await store.getChangeLog('doc-1')
			expect(entry.operations.deletes).toEqual([makeRecord({ id: 'a', parent: childRef('p') })])
		},
	},
	'a create entry carries the record created': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			const created = makeRecord({ id: 'r1', children: [childRef('c1')] })
			await commit({ store, documentId: 'doc-1', creates: [created] })
			const [entry] = await store.getChangeLog('doc-1')
			expect(entry.operations.creates).toEqual([created])
		},
	},
}

// ── Rejected writes ──────────────────────────────────────────────────────────

const rejectedWrites: StoreContractCases = {
	'registering an id already registered is rejected and the first stays': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ name: 'first' }))
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			await expectRejectsWith({
				action: store.registerDocument(makeDocument({ name: 'second' })),
				key: 'STORE_DUPLICATE_ID',
				meta: { documentId: 'doc-1' },
			})
			expect((await store.getDocument('doc-1'))?.name).toBe('first')
			expect(await store.count('doc-1')).toBe(1)
		},
	},
	'a bulk write creating an id the document holds is rejected and nothing of it lands': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await expectRejectsWith({
				action: store.bulkWrite('doc-1', {
					creates: [makeRecord({ id: 'r9' }), makeRecord({ id: 'r1', value: 'x' })],
				}),
				key: 'STORE_DUPLICATE_ID',
				meta: { documentId: 'doc-1', recordIds: ['r1'] },
			})
			expect(await store.get('r9', 'doc-1')).toBeUndefined()
			expect((await store.get('r1', 'doc-1'))?.value).toBe('')
			expect(await store.count('doc-1')).toBe(2)
		},
	},
	'a commit creating an id the document holds is rejected, nothing lands, no history entry': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await expectRejectsWith({
				action: commit({
					store,
					documentId: 'doc-1',
					creates: [makeRecord({ id: 'r9' }), makeRecord({ id: 'r1', value: 'x' })],
					deletes: ['r2'],
				}),
				key: 'STORE_DUPLICATE_ID',
				meta: { documentId: 'doc-1', recordIds: ['r1'] },
			})
			expect(await store.get('r9', 'doc-1')).toBeUndefined()
			expect((await store.get('r1', 'doc-1'))?.value).toBe('')
			expect(await store.get('r2', 'doc-1')).toBeDefined()
			expect(await store.getChangeLog('doc-1')).toEqual([])
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: false, canRedo: false })
		},
	},
	'a bulk write holding one id twice is rejected and nothing of it lands': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await expectRejectsWith({
				action: store.bulkWrite('doc-1', {
					creates: [makeRecord({ id: 'r1' }), makeRecord({ id: 'r1', value: 'twice' })],
				}),
				key: 'STORE_DUPLICATE_ID',
				meta: { documentId: 'doc-1', recordIds: ['r1'] },
				detail: /given twice: r1$/,
			})
			expect(await store.count('doc-1')).toBe(0)
		},
	},
	'a bulk write giving twice an id the document holds is rejected, the id named once': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await expectRejectsWith({
				action: store.bulkWrite('doc-1', {
					creates: [makeRecord({ id: 'r1', value: 'x' }), makeRecord({ id: 'r1', value: 'y' })],
				}),
				key: 'STORE_DUPLICATE_ID',
				meta: { documentId: 'doc-1', recordIds: ['r1'] },
				detail: /already holds: r1; given twice: r1$/,
			})
			expect((await store.get('r1', 'doc-1'))?.value).toBe('')
		},
	},
	'a commit holding one id twice is rejected, nothing lands, no history entry': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await expectRejectsWith({
				action: commit({
					store,
					documentId: 'doc-1',
					creates: [makeRecord({ id: 'r1' }), makeRecord({ id: 'r1', value: 'twice' })],
				}),
				key: 'STORE_DUPLICATE_ID',
				meta: { documentId: 'doc-1', recordIds: ['r1'] },
			})
			expect(await store.count('doc-1')).toBe(0)
			expect(await store.getChangeLog('doc-1')).toEqual([])
		},
	},
	'a commit updating a record the document does not hold is rejected and nothing lands': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await expectRejectsWith({
				action: commit({
					store,
					documentId: 'doc-1',
					creates: [makeRecord({ id: 'r9' })],
					updates: [makeRecord({ id: 'nope', value: 'x' })],
				}),
				key: 'STORE_RECORD_NOT_FOUND',
				meta: { documentId: 'doc-1', recordId: 'nope' },
			})
			expect(await store.get('r9', 'doc-1')).toBeUndefined()
			expect(await store.get('nope', 'doc-1')).toBeUndefined()
			expect(await store.getChangeLog('doc-1')).toEqual([])
		},
	},
	'a commit with a taken id and an absent update is refused for the absent update': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await expectRejectsWith({
				action: commit({
					store,
					documentId: 'doc-1',
					creates: [makeRecord({ id: 'r1', value: 'x' })],
					updates: [makeRecord({ id: 'nope', value: 'x' })],
				}),
				key: 'STORE_RECORD_NOT_FOUND',
				meta: { documentId: 'doc-1', recordId: 'nope' },
			})
			expect((await store.get('r1', 'doc-1'))?.value).toBe('')
			expect(await store.getChangeLog('doc-1')).toEqual([])
		},
	},
	'a commit deleting an absent id deletes nothing of it and snapshots nothing of it': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await commit({ store, documentId: 'doc-1', deletes: ['nope', 'r1'] })
			const [entry] = await store.getChangeLog('doc-1')
			expect(entry.operations.deletes.map((record) => record.id)).toEqual(['r1'])
			await store.undo('doc-1')
			expect(await store.count('doc-1')).toBe(2)
		},
	},
	'a bulk write to an unregistered document is rejected': {
		act: async ({ store }) => {
			await expectRejectsWith({
				action: store.bulkWrite('nope', { creates: [makeRecord({ id: 'r1' })] }),
				key: 'DOCUMENT_NOT_REGISTERED',
				meta: { documentId: 'nope' },
			})
			expect(await store.get('r1')).toBeUndefined()
		},
	},
	'a commit to an unregistered document is rejected': {
		act: async ({ store }) => {
			await expectRejectsWith({
				action: commit({ store, documentId: 'nope', creates: [makeRecord({ id: 'r1' })] }),
				key: 'DOCUMENT_NOT_REGISTERED',
				meta: { documentId: 'nope' },
			})
			expect(await store.get('r1')).toBeUndefined()
			expect(await store.getChangeLog('nope')).toEqual([])
		},
	},
}

// ── A document that is not there ─────────────────────────────────────────────

/** Each read of a document that is not there, and what it answers. */
const readsOfAbsentDocument: Record<string, AbsentDocumentRead> = {
	'get reads undefined': { read: (store) => store.get('r1', 'nope'), expected: undefined },
	'getByDocumentId reads []': { read: (store) => store.getByDocumentId('nope'), expected: [] },
	'count reads 0': { read: (store) => store.count('nope'), expected: 0 },
	'getByTagNameInDocument reads []': {
		read: (store) => store.getByTagNameInDocument('A', 'nope'),
		expected: [],
	},
	'getMany reads undefined per id': {
		read: (store) => store.getMany(['r1', 'r2'], 'nope'),
		expected: [undefined, undefined],
	},
	'getChangeLog reads []': { read: (store) => store.getChangeLog('nope'), expected: [] },
	'getHistoryStatus reads neither undo nor redo': {
		read: (store) => store.getHistoryStatus('nope'),
		expected: { canUndo: false, canRedo: false },
	},
	'getBlobsByDocument reads []': {
		read: (store) => store.getBlobsByDocument('nope'),
		expected: [],
	},
}

const absentDocument: StoreContractCases = {
	...Object.fromEntries(
		Object.entries(readsOfAbsentDocument).map(([description, { read, expected }]) => [
			`never registered: ${description}`,
			{
				act: async ({ store }: StoreContractContext) => {
					await seedTwoRecords(store)
					expect(await read(store)).toEqual(expected)
				},
			},
		]),
	),
	...Object.fromEntries(
		Object.entries(readsOfAbsentDocument).map(([description, { read, expected }]) => [
			`removed: ${description}`,
			{
				act: async ({ store }: StoreContractContext) => {
					await store.registerDocument(makeDocument({ id: 'nope' }))
					await commit({
						store,
						documentId: 'nope',
						creates: [makeRecord({ id: 'r1' }), makeRecord({ id: 'r2' })],
					})
					await store.removeDocument('nope')
					expect(await read(store)).toEqual(expected)
				},
			},
		]),
	),
	'updateDocument of an unknown document registers nothing': {
		act: async ({ store }) => {
			await store.updateDocument('nope', { name: 'x' })
			expect(await store.getDocument('nope')).toBeUndefined()
			expect(await store.getDocuments()).toEqual([])
		},
	},
	'removeDocument of an unknown document resolves': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await expect(store.removeDocument('nope')).resolves.toBeUndefined()
			expect(await store.count('doc-1')).toBe(2)
		},
	},
	'undo and redo of an unknown document resolve and write nothing': {
		act: async ({ store }) => {
			await expect(store.undo('nope')).resolves.toBeUndefined()
			await expect(store.redo('nope')).resolves.toBeUndefined()
			expect(await store.getDocuments()).toEqual([])
		},
	},
}

// ── A removed document leaves no history ─────────────────────────────────────

const removedDocument: StoreContractCases = {
	'a document registered again under a removed id starts with no history': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r1' })] })
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r2' })] })
			await store.undo('doc-1')
			await store.removeDocument('doc-1')
			await store.registerDocument(makeDocument())
			expect(await store.getChangeLog('doc-1')).toEqual([])
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: false, canRedo: false })
			await store.undo('doc-1')
			await store.redo('doc-1')
			expect(await store.getByDocumentId('doc-1')).toEqual([])
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r3' })] })
			expect((await store.getChangeLog('doc-1')).map((entry) => entry.sequenceNumber)).toEqual([1])
		},
	},
	'a removal leaves the history of the other documents alone': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: 'a' }))
			await store.registerDocument(makeDocument({ id: 'b' }))
			await commit({ store, documentId: 'a', creates: [makeRecord({ id: 'ra' })] })
			await commit({ store, documentId: 'b', creates: [makeRecord({ id: 'rb' })] })
			await store.removeDocument('a')
			expect(await store.getChangeLog('b')).toHaveLength(1)
			await store.undo('b')
			expect(await store.get('rb', 'b')).toBeUndefined()
			await store.redo('b')
			expect(await store.get('rb', 'b')).toBeDefined()
		},
	},
}

// ── An edit during an import ─────────────────────────────────────────────────

const duringImport: StoreContractCases = {
	'a commit on one document lands between the batches of another document being imported': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: 'b' }))
			await store.bulkWrite('b', { creates: [makeRecord({ id: 'rb' })] })
			await store.registerDocument(makeDocument({ id: 'a', status: 'importing', importingAt: 1 }))
			await store.bulkWrite('a', { creates: [makeRecord({ id: 'a1' })] })

			await commit({ store, documentId: 'b', updates: [makeRecord({ id: 'rb', value: 'edited' })] })

			await store.bulkWrite('a', {
				creates: [makeRecord({ id: 'a2' })],
				updates: [{ recordId: 'a1', children: [childRef('a2')] }],
			})
			await store.updateDocument('a', { status: 'ready' })

			expect((await store.get('rb', 'b'))?.value).toBe('edited')
			expect(await store.getHistoryStatus('b')).toEqual({ canUndo: true, canRedo: false })
			expect((await store.getDocument('a'))?.status).toBe('ready')
			expect(await store.count('a')).toBe(2)
			expect((await store.get('a1', 'a'))?.children).toEqual([childRef('a2')])
			expect(await store.getChangeLog('a')).toEqual([])
			await store.undo('b')
			expect((await store.get('rb', 'b'))?.value).toBe('')
			expect(await store.count('a')).toBe(2)
		},
	},
	'the registry lists a document being imported with its status, and reads it as it is': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: 'a', status: 'importing', importingAt: 1 }))
			await store.bulkWrite('a', { creates: [makeRecord({ id: 'a1' })] })
			expect((await store.getDocuments()).map((document) => document.status)).toEqual(['importing'])
			expect(await store.count('a')).toBe(1)
			await store.updateDocument('a', { status: 'ready', importingAt: undefined })
			expect(await store.getDocument('a')).toEqual(
				makeDocument({ id: 'a', importingAt: undefined }),
			)
		},
	},
}

// ── One state for every connection ───────────────────────────────────────────

const oneState: StoreContractCases = {
	'a document registered and written through one connection is read through another': {
		needs: 'second-connection',
		act: async ({ store, connect }) => {
			const other = await connect()
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			expect(await other.getDocument('doc-1')).toEqual(makeDocument())
			expect((await other.getByDocumentId('doc-1')).map((record) => record.id)).toEqual(['r1'])
		},
	},
	'a document removed through one connection is gone through another': {
		needs: 'second-connection',
		act: async ({ store, connect }) => {
			const other = await connect()
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			expect(await other.count('doc-1')).toBe(1)
			await store.removeDocument('doc-1')
			expect(await other.getDocument('doc-1')).toBeUndefined()
			expect(await other.getDocuments()).toEqual([])
			expect(await other.getByDocumentId('doc-1')).toEqual([])
			expect(await other.count('doc-1')).toBe(0)
		},
	},
	'a commit through one connection is seen, and undone, through another': {
		needs: 'second-connection',
		act: async ({ store, connect }) => {
			const other = await connect()
			await store.registerDocument(makeDocument())
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r1' })] })
			expect(await other.get('r1', 'doc-1')).toEqual(makeRecord({ id: 'r1' }))
			expect(await other.getHistoryStatus('doc-1')).toEqual({ canUndo: true, canRedo: false })
			await other.undo('doc-1')
			expect(await store.get('r1', 'doc-1')).toBeUndefined()
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: false, canRedo: true })
		},
	},
	'a write through one connection is refused the ids another connection took': {
		needs: 'second-connection',
		act: async ({ store, connect }) => {
			const other = await connect()
			await store.registerDocument(makeDocument())
			await other.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			await expectRejectsWith({
				action: store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] }),
				key: 'STORE_DUPLICATE_ID',
			})
			await expectRejectsWith({
				action: other.registerDocument(makeDocument()),
				key: 'STORE_DUPLICATE_ID',
			})
		},
	},
}

export const STORE_CONTRACT: StoreContractGroups = {
	lifecycle,
	'document registry': registry,
	reads,
	'bulk writes': bulkWrites,
	'commit and history': history,
	reopen,
	'sibling order': siblingOrder,
	'changelog snapshots': snapshots,
	'rejected writes': rejectedWrites,
	'a document that is not there': absentDocument,
	'a removed document leaves no history': removedDocument,
	'an edit during an import': duringImport,
	'one state for every connection': oneState,
	blobs,
}
