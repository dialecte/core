import { JSON_MAX_DEPTH } from '../json-values.constants'
import {
	CONTRACT_LEVELS_ABOVE_ATTRIBUTE_VALUE,
	CONTRACT_LEVELS_ABOVE_METADATA_VALUE,
	CONTRACT_LONE_SURROGATE_TEXT,
	CONTRACT_SESSION_DIAGNOSTICS,
	CONTRACT_SESSION_FAIL_VALUE,
	CONTRACT_SESSION_FUNCTION_VALUE,
	CONTRACT_SESSION_LONE_SURROGATE_VALUE,
	CONTRACT_SESSION_SEEN_ATTRIBUTE,
	CONTRACT_SESSION_TAG,
} from './store-contract.constants'
import {
	childRef,
	commit,
	contractFile,
	expectRejectsWith,
	makeBlobEntry,
	makeDocument,
	makeRecord,
	nestedArrays,
	scribble,
	sessionRecords,
	SMALL_BATCHES,
} from './store-contract.fixtures'
import { holdContractImport, untilHeld } from './store-contract.import-session'

import { expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE, DIALECTE_DEV_NAMESPACE } from '@/helpers/constant'

import type { JsonWithRawJson } from '../json-values.types'
import type { ImportProgress, Store, WriteOutcome } from '../store.types'
import type {
	AbsentDocumentRead,
	AttributePatchCase,
	NestingPlace,
	NonJsonPlace,
	OperationInFlight,
	OrderedRead,
	RefusedWrite,
	StoreOperation,
	SiblingOrderStep,
	StoreContractCases,
	StoreContractContext,
	StoreContractGroups,
	StoreContractNeed,
	ValueRead,
	ValueWrite,
} from './store-contract.types'
import type { DocumentRecord, DocumentUpdates } from '@/project/types'
import type { AnyRawRecord, BlobAttachment, BlobRecord, RecordPatch } from '@/types'

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

const documentUpdates: Record<string, DocumentUpdates> = {
	name: { name: 'renamed' },
	metadata: { metadata: { origin: 'test' } },
	status: { status: 'importing' },
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
			expect(documents.map((document) => document.id)).toEqual(['a', 'b'])
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
	'an unknown id reads undefined': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			expect(await store.get('nope', 'doc-1')).toBeUndefined()
		},
	},
	'getByDocumentId returns every record of the document': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			const records = await store.getByDocumentId('doc-1')
			expect(records.map((record) => record.id)).toEqual(['r1', 'r2'])
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
			expect(records.map((record) => record.id)).toEqual(['r1', 'r3'])
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
			const record = makeRecord({
				id: 'r1',
				value: 'text',
				children: [{ id: 'c1', tagName: 'B' }],
			})
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
	'update patch of a record created by the same write → applied to it': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', {
				creates: [makeRecord({ id: 'r9' })],
				updates: [{ recordId: 'r9', value: 'patched' }],
			})
			expect(await store.get('r9', 'doc-1')).toEqual(makeRecord({ id: 'r9', value: 'patched' }))
		},
	},
	'two patches of one record in one write → applied in the order given': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			await store.bulkWrite('doc-1', {
				updates: [
					{ recordId: 'r1', attributes: [{ name: 'b', value: 'first' }], value: 'first' },
					{ recordId: 'r1', attributes: [{ name: 'b', value: 'second' }] },
				],
			})
			expect(await store.get('r1', 'doc-1')).toEqual(
				makeRecord({
					id: 'r1',
					value: 'first',
					attributes: [
						{ name: 'a', value: '1' },
						{ name: 'b', value: 'second' },
					],
				}),
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
	'count follows a bulk write creating and deleting, an id deleted twice': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await store.bulkWrite('doc-1', {
				creates: [makeRecord({ id: 'r3' })],
				deletes: ['r1', 'r3', 'r1'],
			})
			expect(await store.count('doc-1')).toBe(1)
			expect((await store.getByDocumentId('doc-1')).map((record) => record.id)).toEqual(['r2'])
		},
	},
	'leaves no history: bulk writes are not undoable': {
		needs: ['history'],
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

/** Progress listeners that fail: a store ignores their failure, as it never awaits them. */
const FAILING_PROGRESS_LISTENERS: Record<string, (current: number, total: number) => unknown> = {
	throws: () => {
		throw new Error('listener failed')
	},
	rejects: () => Promise.reject(new Error('listener failed')),
}

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
	'commit reports progress up to the number of operations; a listener slow on every tick still hears the last one before the commit resolves':
		{
			// a guard every store keeps; the order of ticks and answer is pinned where it is made (the engine's wire)
			act: async ({ store }) => {
				await seedTwoRecords(store)
				const reported: [number, number][] = []
				await store.commit({
					documentId: 'doc-1',
					creates: [makeRecord({ id: 'r3' })],
					updates: [makeRecord({ id: 'r1', value: 'v' })],
					deletes: ['r2'],
					onProgress: function stallOnEachTick(current, total) {
						reported.push([current, total])
						const until = performance.now() + 30
						while (performance.now() < until);
					},
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
	'a commit asked by its id → applied once committed, still applied after its undo': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await commit({
				store,
				documentId: 'doc-1',
				writeId: 'w1',
				creates: [makeRecord({ id: 'r1' })],
			})
			expect(await store.getWriteOutcome({ writeId: 'w1' })).toBe('applied')
			await store.undo('doc-1')
			expect(await store.getWriteOutcome({ writeId: 'w1' })).toBe('applied')
		},
	},
	'a commit undone, then discarded by a later commit, asked by its id → still applied': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await commit({
				store,
				documentId: 'doc-1',
				writeId: 'w1',
				creates: [makeRecord({ id: 'r1' })],
			})
			await store.undo('doc-1')
			await commit({
				store,
				documentId: 'doc-1',
				writeId: 'w2',
				creates: [makeRecord({ id: 'r2' })],
			})
			expect(await store.getWriteOutcome({ writeId: 'w1' })).toBe('applied')
			expect(await store.getWriteOutcome({ writeId: 'w2' })).toBe('applied')
			expect((await store.getChangeLog('doc-1')).map((entry) => entry.writeId)).toEqual(['w2'])
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: true, canRedo: false })
		},
	},
	'a refused commit asked by its id → not-applied': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await expectRejectsWith({
				action: commit({
					store,
					documentId: 'doc-1',
					writeId: 'w-refused',
					creates: [makeRecord({ id: 'r1' })],
				}),
				key: 'STORE_DUPLICATE_ID',
			})
			expect(await store.getWriteOutcome({ writeId: 'w-refused' })).toBe('not-applied')
		},
	},
	'a commit whose document was removed since, asked by its id → not-applied': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await commit({
				store,
				documentId: 'doc-1',
				writeId: 'w1',
				creates: [makeRecord({ id: 'r1' })],
			})
			await store.removeDocument('doc-1')
			expect(await store.getWriteOutcome({ writeId: 'w1' })).toBe('not-applied')
		},
	},
	'a history entry carries the id of its commit, one of its own when none was given': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await commit({
				store,
				documentId: 'doc-1',
				writeId: 'w1',
				creates: [makeRecord({ id: 'r1' })],
			})
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r2' })] })
			await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r3' })] })
			const [given, ...generated] = (await store.getChangeLog('doc-1')).map(
				(entry) => entry.writeId,
			)
			expect(given).toBe('w1')
			expect(generated.every((writeId) => typeof writeId === 'string')).toBe(true)
			expect(new Set(generated).size).toBe(2)
			expect(generated).not.toContain('w1')
			for (const writeId of generated) {
				expect(await store.getWriteOutcome({ writeId })).toBe('applied')
			}
		},
	},
	'a commit creating and deleting one id → nothing of it after the commit, its undo or its redo': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await commit({
				store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'r1' })],
				deletes: ['r1'],
			})
			expect(await store.get('r1', 'doc-1'), 'after the commit').toBeUndefined()
			await store.undo('doc-1')
			expect(await store.get('r1', 'doc-1'), 'after its undo').toBeUndefined()
			await store.redo('doc-1')
			expect(await store.get('r1', 'doc-1'), 'after its redo').toBeUndefined()
			expect(await store.count('doc-1')).toBe(0)
		},
	},
	'a commit updating and deleting one id → undo gives it back as before, redo leaves nothing': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await commit({
				store,
				documentId: 'doc-1',
				updates: [makeRecord({ id: 'r1', value: 'v' })],
				deletes: ['r1'],
			})
			expect(await store.get('r1', 'doc-1')).toBeUndefined()
			await store.undo('doc-1')
			expect(await store.get('r1', 'doc-1')).toEqual(makeRecord({ id: 'r1', tagName: 'LNode' }))
			await store.redo('doc-1')
			expect(await store.get('r1', 'doc-1')).toBeUndefined()
			expect(await store.count('doc-1')).toBe(1)
		},
	},
	'a commit updating one record twice → the last update stands, undo gives the record as before': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			await commit({
				store,
				documentId: 'doc-1',
				updates: [
					makeRecord({ id: 'r1', value: 'first' }),
					makeRecord({ id: 'r1', value: 'last' }),
				],
			})
			expect((await store.get('r1', 'doc-1'))?.value).toBe('last')
			await store.undo('doc-1')
			expect(await store.get('r1', 'doc-1')).toEqual(makeRecord({ id: 'r1', tagName: 'LNode' }))
			await store.redo('doc-1')
			expect((await store.get('r1', 'doc-1'))?.value).toBe('last')
		},
	},
	...Object.fromEntries(
		Object.entries(FAILING_PROGRESS_LISTENERS).map(([name, listener]) => [
			`a commit whose progress listener ${name} → the commit lands whole, undoable`,
			{
				act: async ({ store }: StoreContractContext) => {
					await seedTwoRecords(store)
					await store.commit({
						documentId: 'doc-1',
						creates: [makeRecord({ id: 'r3' })],
						updates: [makeRecord({ id: 'r1', value: 'v' })],
						deletes: ['r2'],
						onProgress: listener,
					})
					expect((await store.getByDocumentId('doc-1')).map((record) => record.id)).toEqual([
						'r1',
						'r3',
					])
					expect((await store.get('r1', 'doc-1'))?.value).toBe('v')
					await store.undo('doc-1')
					expect((await store.getByDocumentId('doc-1')).map((record) => record.id)).toEqual([
						'r1',
						'r2',
					])
				},
			},
		]),
	),
	'a commit deleting a record, a bulk write creating it again, then the undo → the record as the commit deleted it, counted once':
		{
			act: async ({ store }) => {
				await seedTwoRecords(store)
				await commit({ store, documentId: 'doc-1', deletes: ['r1'] })
				await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1', value: 'again' })] })
				await store.undo('doc-1')
				expect(await store.get('r1', 'doc-1')).toEqual(makeRecord({ id: 'r1', tagName: 'LNode' }))
				expect(await store.count('doc-1')).toBe(2)
				expect((await store.getByDocumentId('doc-1')).map((record) => record.id)).toEqual([
					'r1',
					'r2',
				])
			},
		},
	'a commit creating a record, a bulk write deleting it, then the undo and the redo → the record back after the redo, counted once':
		{
			act: async ({ store }) => {
				await seedTwoRecords(store)
				await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r3' })] })
				await store.bulkWrite('doc-1', { deletes: ['r3'] })
				await store.undo('doc-1')
				expect(await store.get('r3', 'doc-1')).toBeUndefined()
				expect(await store.count('doc-1')).toBe(2)
				await store.redo('doc-1')
				expect(await store.get('r3', 'doc-1')).toEqual(makeRecord({ id: 'r3' }))
				expect(await store.count('doc-1')).toBe(3)
			},
		},
	'a commit’s progress listener reading the store → it reads the whole commit': {
		act: async ({ store }) => {
			await seedTwoRecords(store)
			const reads: Promise<string[]>[] = []
			await store.commit({
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'r3' })],
				updates: [],
				deletes: ['r2'],
				onProgress: () => {
					reads.push(
						store.getByDocumentId('doc-1').then((records) => records.map((record) => record.id)),
					)
				},
			})
			expect(reads.length).toBeGreaterThan(0)
			for (const read of reads) expect(await read).toEqual(['r1', 'r3'])
		},
	},
	'a commit on a document still importing → DOCUMENT_NOT_REGISTERED, nothing written, no entry': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ status: 'importing' }))
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			await expectRejectsWith({
				action: commit({
					store,
					documentId: 'doc-1',
					writeId: 'w-importing',
					creates: [makeRecord({ id: 'r2' })],
				}),
				key: 'DOCUMENT_NOT_REGISTERED',
				meta: { documentId: 'doc-1' },
			})
			expect((await store.getByDocumentId('doc-1')).map((record) => record.id)).toEqual(['r1'])
			expect(await store.getChangeLog('doc-1')).toEqual([])
			expect(await store.getWriteOutcome({ writeId: 'w-importing' })).toBe('not-applied')
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
			expect((await reopened.getByDocumentId('doc-1')).map((record) => record.id)).toEqual([
				'r1',
				'r2',
			])
		},
	},
	'history is there again after a reopen: undo still works': {
		needs: ['history'],
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
		needs: ['history'],
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
		needs: ['history'],
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
		needs: ['history'],
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
		needs: ['history'],
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
		needs: ['history'],
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
		needs: ['history'],
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
			needs: step.needs,
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

/** A record holding a value that is not JSON: a function. */
function nonJsonRecord(params: { id: string }): AnyRawRecord {
	return { ...makeRecord({ id: params.id }), value: (() => '') as unknown as string }
}

/**
 * A write of a value that is not JSON, alone or with another fault, and the refusal it must answer,
 * in the order every store meets them: an absent update, then the creates checked (one that is not
 * JSON refuses the batch), then a taken id, then the updates checked.
 */
const NON_JSON_WRITES: Record<string, RefusedWrite> = {
	'bulkWrite creates': {
		write: (store) => store.bulkWrite('doc-1', { creates: [nonJsonRecord({ id: 'r9' })] }),
		key: 'STORE_VALUE_NOT_JSON',
	},
	'bulkWrite update patch': {
		write: (store) =>
			store.bulkWrite('doc-1', {
				updates: [{ recordId: 'r1', value: (() => '') as unknown as string }],
			}),
		key: 'STORE_VALUE_NOT_JSON',
	},
	'commit creates': {
		needs: ['history'],
		write: (store) =>
			commit({ store, documentId: 'doc-1', creates: [nonJsonRecord({ id: 'r9' })] }),
		key: 'STORE_VALUE_NOT_JSON',
	},
	'commit updates': {
		needs: ['history'],
		write: (store) =>
			commit({ store, documentId: 'doc-1', updates: [nonJsonRecord({ id: 'r1' })] }),
		key: 'STORE_VALUE_NOT_JSON',
	},
	'bulkWrite creating a taken id with an update': {
		write: (store) =>
			store.bulkWrite('doc-1', {
				creates: [makeRecord({ id: 'r1' })],
				updates: [{ recordId: 'r1', value: (() => '') as unknown as string }],
			}),
		key: 'STORE_DUPLICATE_ID',
	},
	'commit creating a taken id with an update': {
		needs: ['history'],
		write: (store) =>
			commit({
				store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'r1' })],
				updates: [nonJsonRecord({ id: 'r1' })],
			}),
		key: 'STORE_DUPLICATE_ID',
	},
	'bulkWrite creating a taken id and a create': {
		write: (store) =>
			store.bulkWrite('doc-1', {
				creates: [makeRecord({ id: 'r1' }), nonJsonRecord({ id: 'r9' })],
			}),
		key: 'STORE_VALUE_NOT_JSON',
	},
	'commit creating a taken id and a create': {
		needs: ['history'],
		write: (store) =>
			commit({
				store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'r1' }), nonJsonRecord({ id: 'r9' })],
			}),
		key: 'STORE_VALUE_NOT_JSON',
	},
	'commit updating an absent record with a create': {
		needs: ['history'],
		write: (store) =>
			commit({
				store,
				documentId: 'doc-1',
				creates: [nonJsonRecord({ id: 'r9' })],
				updates: [makeRecord({ id: 'absent' })],
			}),
		key: 'STORE_RECORD_NOT_FOUND',
	},
}

const nonJsonPatchOfAbsentRecord: StoreContractCases = {
	'bulkWrite update patch of an absent record holding a value that is not JSON → skipped as every absent patch, nothing written':
		{
			act: async ({ store }) => {
				await store.registerDocument(makeDocument())
				await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
				await store.bulkWrite('doc-1', {
					updates: [{ recordId: 'absent', value: (() => '') as unknown as string }],
				})
				expect(await store.getByDocumentId('doc-1')).toEqual([makeRecord({ id: 'r1' })])
			},
		},
}

const nonJsonWrites: StoreContractCases = Object.fromEntries(
	Object.entries(NON_JSON_WRITES).map(([name, { needs, write, key }]) => {
		const keepsHistory = needs?.includes('history') ?? false
		return [
			`${name} of a value that is not JSON (a function) → ${key}, the record and its count as they were${keepsHistory ? ', no history' : ''}`,
			{
				needs,
				act: async ({ store }: StoreContractContext) => {
					await store.registerDocument(makeDocument())
					await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
					expect(await store.count('doc-1')).toBe(1)
					await expectRejectsWith({ action: write(store), key })
					expect(await store.getByDocumentId('doc-1')).toEqual([makeRecord({ id: 'r1' })])
					expect(await store.count('doc-1')).toBe(1)
					if (keepsHistory) {
						expect(await store.getHistoryStatus('doc-1')).toEqual({
							canUndo: false,
							canRedo: false,
						})
					}
				},
			},
		]
	}),
)

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
		needs: ['history'],
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
		needs: ['history'],
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
		needs: ['history'],
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
		needs: ['history'],
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
		needs: ['history'],
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
			expect(await store.get('r1', 'nope')).toBeUndefined()
		},
	},
	'a commit to an unregistered document is rejected': {
		needs: ['history'],
		act: async ({ store }) => {
			await expectRejectsWith({
				action: commit({ store, documentId: 'nope', creates: [makeRecord({ id: 'r1' })] }),
				key: 'DOCUMENT_NOT_REGISTERED',
				meta: { documentId: 'nope' },
			})
			expect(await store.get('r1', 'nope')).toBeUndefined()
			expect(await store.getChangeLog('nope')).toEqual([])
		},
	},
}

// ── JSON values only ─────────────────────────────────────────────────────────

/** An instance of a class: a store keeps plain objects only. */
class HeldInstance {}

/** Each value that is not plain JSON, built fresh for each case. */
const NON_JSON_VALUES: Record<string, () => unknown> = {
	'a Date': () => new Date(0),
	'a Map': () => new Map([['k', 'v']]),
	'a Set': () => new Set(['v']),
	NaN: () => Number.NaN,
	Infinity: () => Number.POSITIVE_INFINITY,
	'a BigInt': () => BigInt(1),
	'a function': () => () => '',
	'a symbol': () => Symbol('held'),
	'an instance of a class': () => new HeldInstance(),
	'an array holding undefined': () => [undefined],
	'a raw JSON value': () => (JSON as JsonWithRawJson).rawJSON?.('1'),
	'text that is not well-formed': () => CONTRACT_LONE_SURROGATE_TEXT,
}

/** Where a write hands the store a value: every store refuses one that is not JSON there. */
const NON_JSON_PLACES: Record<string, NonJsonPlace> = {
	'a record created': {
		write: ({ store, value }) =>
			store.bulkWrite('doc-1', {
				creates: [makeRecord({ id: 'r9', attributes: [{ name: 'a', value: value as string }] })],
			}),
	},
	'the value of a record created': {
		write: ({ store, value }) =>
			store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r9', value: value as string })] }),
	},
	'a record patched': {
		write: ({ store, value }) =>
			store.bulkWrite('doc-1', {
				updates: [{ recordId: 'r1', attributes: [{ name: 'a', value: value as string }] }],
			}),
	},
	'the attributes a patch removes': {
		write: ({ store, value }) =>
			store.bulkWrite('doc-1', {
				updates: [{ recordId: 'r1', removeAttributes: [value as string] }],
			}),
	},
	'the first of two patches of one record': {
		write: ({ store, value }) =>
			store.bulkWrite('doc-1', {
				updates: [
					{ recordId: 'r1', value: value as string },
					{ recordId: 'r1', value: 'x' },
				],
			}),
	},
	'a record created by a commit': {
		needs: ['history'],
		write: ({ store, value }) =>
			commit({
				store,
				documentId: 'doc-1',
				creates: [makeRecord({ id: 'r9', attributes: [{ name: 'a', value: value as string }] })],
			}),
	},
	'a record updated by a commit': {
		needs: ['history'],
		write: ({ store, value }) =>
			commit({
				store,
				documentId: 'doc-1',
				updates: [makeRecord({ id: 'r1', attributes: [{ name: 'a', value: value as string }] })],
			}),
	},
	'the metadata of a document registered': {
		write: ({ store, value }) =>
			store.registerDocument(makeDocument({ id: 'doc-2', metadata: { origin: { held: value } } })),
	},
	'the metadata of a document updated': {
		write: ({ store, value }) =>
			store.updateDocument('doc-1', { metadata: { origin: { held: value } } }),
	},
}

const nonJsonValues: StoreContractCases = Object.fromEntries(
	Object.entries(NON_JSON_PLACES).flatMap(([place, { needs, write }]) =>
		Object.entries(NON_JSON_VALUES).map(([kind, value]) => [
			`${kind} in ${place} → STORE_VALUE_NOT_JSON, nothing written`,
			{
				needs,
				act: async ({ store }: StoreContractContext) => {
					await store.registerDocument(makeDocument())
					await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
					await expectRejectsWith({
						action: write({ store, value: value() }),
						key: 'STORE_VALUE_NOT_JSON',
					})
					expect(await store.getDocuments()).toEqual([makeDocument()])
					expect(await store.getByDocumentId('doc-1')).toEqual([makeRecord({ id: 'r1' })])
				},
			},
		]),
	),
)

/** A record object carrying fields its type does not have: at the top, in its namespace, in its parent. */
function recordWithExtras(params: { id: string; value?: string }): AnyRawRecord {
	const { id, value = '' } = params
	return {
		...makeRecord({ id, value }),
		namespace: { prefix: '', uri: '', extra: 'n' },
		parent: { ...childRef('r0'), extra: 'p' },
		extra: 'r',
	} as unknown as AnyRawRecord
}

/** The same record as every store keeps it: the fields of the record type only. */
function recordKept(params: { id: string; value?: string }): AnyRawRecord {
	const { id, value = '' } = params
	return makeRecord({ id, value, parent: childRef('r0') })
}

/** Writes handing records (or patches) with fields their type does not have, and the record each leaves. */
const EXTRA_FIELD_WRITES: Record<
	string,
	{
		needs?: StoreContractNeed[]
		write: (store: Store) => Promise<void>
		id: string
		value?: string
	}
> = {
	'a bulk write creating it': {
		write: (store) => store.bulkWrite('doc-1', { creates: [recordWithExtras({ id: 'r9' })] }),
		id: 'r9',
	},
	'a bulk write patching it': {
		write: async (store) => {
			await store.bulkWrite('doc-1', { creates: [recordKept({ id: 'r9' })] })
			await store.bulkWrite('doc-1', {
				updates: [{ recordId: 'r9', value: 'v', extra: 'r' } as RecordPatch],
			})
		},
		id: 'r9',
		value: 'v',
	},
	'a commit creating it': {
		needs: ['history'],
		write: (store) =>
			commit({ store, documentId: 'doc-1', creates: [recordWithExtras({ id: 'r9' })] }),
		id: 'r9',
	},
	'a commit updating it': {
		needs: ['history'],
		write: async (store) => {
			await store.bulkWrite('doc-1', { creates: [recordKept({ id: 'r9' })] })
			await commit({
				store,
				documentId: 'doc-1',
				updates: [recordWithExtras({ id: 'r9', value: 'v' })],
			})
		},
		id: 'r9',
		value: 'v',
	},
}

const extraFieldsDropped: StoreContractCases = Object.fromEntries(
	Object.entries(EXTRA_FIELD_WRITES).map(([write, { needs, write: run, id, value }]) => [
		`${write} with fields the record type does not have (at its top, in its namespace, in its parent) → read without them`,
		{
			needs,
			act: async ({ store }: StoreContractContext) => {
				await store.registerDocument(makeDocument())
				await run(store)
				const kept = recordKept({ id, value })
				expect(await store.get(id, 'doc-1')).toStrictEqual(kept)
				expect(await store.getMany([id], 'doc-1')).toStrictEqual([kept])
				expect(await store.getByDocumentId('doc-1')).toStrictEqual([kept])
				if (needs?.includes('history')) {
					await store.undo('doc-1')
					await store.redo('doc-1')
					expect(await store.get(id, 'doc-1')).toStrictEqual(kept)
				}
			},
		},
	]),
)

/** How many patches the long-list cases hand at once: more than a store may check in one go. */
const MANY_PATCHES = 1500

/** The patch the long-list cases refuse, by its place among the patches handed (all of which apply). */
const REFUSED_PATCH_AT = 1200

const nonJsonPatchPlace: StoreContractCases = {
	[`a bulk write of ${MANY_PATCHES} patches whose patch ${REFUSED_PATCH_AT} is not JSON → STORE_VALUE_NOT_JSON naming its place in the whole list, nothing written`]:
		{
			act: async ({ store }) => {
				await store.registerDocument(makeDocument())
				const ids = Array.from({ length: MANY_PATCHES }, (_, index) => `r${index}`)
				await store.bulkWrite('doc-1', { creates: ids.map((id) => makeRecord({ id })) })
				const updates: RecordPatch[] = ids.map((recordId) => ({ recordId, value: 'v' }))
				updates[REFUSED_PATCH_AT] = Object.assign(new HeldInstance(), {
					recordId: ids[REFUSED_PATCH_AT]!,
					value: 'v',
				})
				await expectRejectsWith({
					action: store.bulkWrite('doc-1', { updates }),
					key: 'STORE_VALUE_NOT_JSON',
					detail: new RegExp(`field "${REFUSED_PATCH_AT}"`),
				})
				expect((await store.getByDocumentId('doc-1')).every((record) => record.value === '')).toBe(
					true,
				)
			},
		},
}

/** A proxy over plain data, as a reactive framework hands its objects: it reads as the data. */
function reactive<GenericValue extends object>(value: GenericValue): GenericValue {
	return new Proxy(value, {})
}

const proxiesKept: StoreContractCases = {
	'a document registered, records created by a bulk write and by a commit, each a proxy over plain data → kept as the plain data they read as':
		{
			needs: ['history'],
			act: async ({ store }) => {
				await store.registerDocument(
					reactive(makeDocument({ metadata: reactive({ origin: 'ui' }) })),
				)
				await store.bulkWrite('doc-1', { creates: reactive([reactive(makeRecord({ id: 'r1' }))]) })
				await commit({
					store,
					documentId: 'doc-1',
					creates: [
						reactive(makeRecord({ id: 'r2', attributes: [reactive({ name: 'a', value: '1' })] })),
					],
				})
				expect(await store.getDocuments()).toEqual([makeDocument({ metadata: { origin: 'ui' } })])
				expect(await store.getByDocumentId('doc-1')).toEqual([
					makeRecord({ id: 'r1' }),
					makeRecord({ id: 'r2', attributes: [{ name: 'a', value: '1' }] }),
				])
			},
		},
}

const undefinedFieldsDropped: StoreContractCases = {
	'a document registered with fields holding undefined → read without them': {
		act: async ({ store }) => {
			await store.registerDocument(
				makeDocument({ metadata: { origin: 'test', gone: undefined }, writeId: undefined }),
			)
			expect(await store.getDocument('doc-1')).toStrictEqual(
				makeDocument({ metadata: { origin: 'test' } }),
			)
		},
	},
	'a document updated with fields holding undefined → those fields as they were, undefined dropped from the metadata':
		{
			act: async ({ store }) => {
				await store.registerDocument(makeDocument())
				await store.updateDocument('doc-1', {
					name: undefined,
					metadata: { origin: 'test', gone: undefined },
				})
				expect(await store.getDocument('doc-1')).toStrictEqual(
					makeDocument({ metadata: { origin: 'test' } }),
				)
			},
		},
	'a document updated with metadata undefined → its metadata kept': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ metadata: { origin: 'test' } }))
			await store.updateDocument('doc-1', { metadata: undefined })
			expect(await store.getDocument('doc-1')).toStrictEqual(
				makeDocument({ metadata: { origin: 'test' } }),
			)
		},
	},
	'a record created with a field holding undefined → read without it': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			const attribute = { name: 'a', value: '1', gone: undefined }
			await store.bulkWrite('doc-1', {
				creates: [makeRecord({ id: 'r1', attributes: [attribute] })],
			})
			expect(await store.get('r1', 'doc-1')).toStrictEqual(makeRecord({ id: 'r1' }))
		},
	},
	'a record patched with a field holding undefined → read without it': {
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			const attribute = { name: 'b', value: '2', gone: undefined }
			await store.bulkWrite('doc-1', { updates: [{ recordId: 'r1', attributes: [attribute] }] })
			expect(await store.get('r1', 'doc-1')).toStrictEqual(
				makeRecord({
					id: 'r1',
					attributes: [
						{ name: 'a', value: '1' },
						{ name: 'b', value: '2' },
					],
				}),
			)
		},
	},
}

/** Where a write hands the store a value in a blob entry: every store refuses one that is not JSON there. */
const NON_JSON_BLOB_PLACES: Record<
	string,
	(params: { store: Store; value: unknown }) => Promise<void>
> = {
	'a blob entry added': ({ store, value }) =>
		store.addBlob(
			makeBlobEntry({
				id: 'b9',
				attachedTo: [{ documentId: 'doc-1', recordRef: 'r1', attribute: value as string }],
			}),
			new Blob(['b9']),
		),
	'a reference attached to a blob': ({ store, value }) =>
		store.attachBlob('b1', { documentId: 'doc-1', recordRef: value as string }),
}

const nonJsonBlobValues: StoreContractCases = Object.fromEntries(
	Object.entries(NON_JSON_BLOB_PLACES).flatMap(([place, write]) =>
		Object.entries(NON_JSON_VALUES).map(([kind, value]) => [
			`${kind} in ${place} → STORE_VALUE_NOT_JSON, the blobs as they were`,
			{
				needs: ['blobs'],
				act: async ({ store }: StoreContractContext) => {
					await store.registerDocument(makeDocument())
					const held = makeBlobEntry({ id: 'b1' })
					await store.addBlob(held, new Blob(['b1']))
					await expectRejectsWith({
						action: write({ store, value: value() }),
						key: 'STORE_VALUE_NOT_JSON',
					})
					expect(await store.getStandaloneBlobs()).toEqual([held])
					expect(await store.getBlob('b9')).toBeUndefined()
				},
			},
		]),
	),
)

const nonJsonBlobRefusalOrder: StoreContractCases = {
	'a blob of an owner not registered with an entry that is not JSON → DOCUMENT_NOT_REGISTERED: the owner is checked first':
		{
			needs: ['blobs'],
			act: async ({ store }) => {
				await expectRejectsWith({
					action: store.addBlob(
						makeBlobEntry({ documentId: 'nope', createdAt: Number.NaN }),
						new Blob(['x']),
					),
					key: 'DOCUMENT_NOT_REGISTERED',
					meta: { documentId: 'nope' },
				})
			},
		},
	'an unknown blob attached a reference that is not JSON → STORE_BLOB_NOT_FOUND: the blob is checked first':
		{
			needs: ['blobs'],
			act: async ({ store }) => {
				await expectRejectsWith({
					action: store.attachBlob('nope', {
						documentId: 'doc-1',
						recordRef: new Date(0) as unknown as string,
					}),
					key: 'STORE_BLOB_NOT_FOUND',
				})
			},
		},
}

const nonJsonRefusalOrder: StoreContractCases = {
	'a bulk write creating, deleting and handing a create that is not JSON → refused whole: the records, their count and the documents as they were':
		{
			act: async ({ store }) => {
				await store.registerDocument(makeDocument())
				await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
				expect(await store.count('doc-1')).toBe(1)
				await expectRejectsWith({
					action: store.bulkWrite('doc-1', {
						creates: [
							makeRecord({ id: 'r2' }),
							{ ...makeRecord({ id: 'r9' }), value: new Date(0) as unknown as string },
						],
						updates: [{ recordId: 'r1', value: 'changed' }],
						deletes: ['r1'],
					}),
					key: 'STORE_VALUE_NOT_JSON',
				})
				expect(await store.count('doc-1')).toBe(1)
				expect(await store.getByDocumentId('doc-1')).toEqual([makeRecord({ id: 'r1' })])
				expect(await store.getDocuments()).toEqual([makeDocument()])
			},
		},
	'registering a taken id with metadata that is not JSON → STORE_DUPLICATE_ID: the id is checked first':
		{
			act: async ({ store }) => {
				await store.registerDocument(makeDocument())
				await expectRejectsWith({
					action: store.registerDocument(makeDocument({ metadata: { at: new Date(0) } })),
					key: 'STORE_DUPLICATE_ID',
				})
				expect(await store.getDocuments()).toEqual([makeDocument()])
			},
		},
	'updating a document not registered with metadata that is not JSON → STORE_VALUE_NOT_JSON: the value is checked first':
		{
			act: async ({ store }) => {
				await expectRejectsWith({
					action: store.updateDocument('nope', { metadata: { at: new Date(0) } }),
					key: 'STORE_VALUE_NOT_JSON',
				})
				expect(await store.getDocuments()).toEqual([])
			},
		},
}

// ── JSON nesting depth ───────────────────────────────────────────────────────

/** Where a write hands the store a nested value, counted from the top of what the write hands. */
const NESTING_PLACES: Record<string, NestingPlace> = {
	'an attribute of a record created': {
		levelsAbove: CONTRACT_LEVELS_ABOVE_ATTRIBUTE_VALUE,
		write: ({ store, value }) =>
			store.bulkWrite('doc-1', {
				creates: [makeRecord({ id: 'r9', attributes: [{ name: 'a', value: value as string }] })],
			}),
		read: async (store) => (await store.get('r9', 'doc-1'))?.attributes[0]?.value,
	},
	'an attribute of a record patched': {
		levelsAbove: CONTRACT_LEVELS_ABOVE_ATTRIBUTE_VALUE,
		write: ({ store, value }) =>
			store.bulkWrite('doc-1', {
				updates: [{ recordId: 'r1', attributes: [{ name: 'a', value: value as string }] }],
			}),
		read: async (store) => (await store.get('r1', 'doc-1'))?.attributes[0]?.value,
	},
	'the metadata of a document registered': {
		levelsAbove: CONTRACT_LEVELS_ABOVE_METADATA_VALUE,
		write: ({ store, value }) =>
			store.registerDocument(makeDocument({ id: 'doc-2', metadata: { held: value } })),
		read: async (store) => (await store.getDocument('doc-2'))?.metadata?.held,
	},
	'the metadata of a document updated': {
		levelsAbove: CONTRACT_LEVELS_ABOVE_METADATA_VALUE,
		write: ({ store, value }) => store.updateDocument('doc-1', { metadata: { held: value } }),
		read: async (store) => (await store.getDocument('doc-1'))?.metadata?.held,
	},
}

const jsonNestingDepth: StoreContractCases = Object.fromEntries(
	Object.entries(NESTING_PLACES).flatMap(([place, { levelsAbove, write, read }]) => [
		[
			`a value in ${place} reaching the nesting limit → kept`,
			{
				act: async ({ store }: StoreContractContext) => {
					await store.registerDocument(makeDocument())
					await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
					const value = nestedArrays({ levels: JSON_MAX_DEPTH - levelsAbove })
					await write({ store, value })
					expect(await read(store)).toEqual(value)
				},
			},
		],
		[
			`a value in ${place} one level past the nesting limit → STORE_VALUE_NOT_JSON, nothing written`,
			{
				act: async ({ store }: StoreContractContext) => {
					await store.registerDocument(makeDocument())
					await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
					await expectRejectsWith({
						action: write({
							store,
							value: nestedArrays({ levels: JSON_MAX_DEPTH - levelsAbove + 1 }),
						}),
						key: 'STORE_VALUE_NOT_JSON',
					})
					expect(await store.getDocuments()).toEqual([makeDocument()])
					expect(await store.getByDocumentId('doc-1')).toEqual([makeRecord({ id: 'r1' })])
				},
			},
		],
	]),
)

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
	'getChangeLog reads []': {
		needs: ['history'],
		read: (store) => store.getChangeLog('nope'),
		expected: [],
	},
	'getHistoryStatus reads neither undo nor redo': {
		needs: ['history'],
		read: (store) => store.getHistoryStatus('nope'),
		expected: { canUndo: false, canRedo: false },
	},
	'getBlobsByDocument reads []': {
		needs: ['blobs'],
		read: (store) => store.getBlobsByDocument('nope'),
		expected: [],
	},
}

const absentDocument: StoreContractCases = {
	...Object.fromEntries(
		Object.entries(readsOfAbsentDocument).map(([description, { needs, read, expected }]) => [
			`never registered: ${description}`,
			{
				needs,
				act: async ({ store }: StoreContractContext) => {
					await seedTwoRecords(store)
					expect(await read(store)).toEqual(expected)
				},
			},
		]),
	),
	...Object.fromEntries(
		Object.entries(readsOfAbsentDocument).map(([description, { needs = [], read, expected }]) => [
			`removed: ${description}`,
			{
				needs: ['history', ...needs],
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
		needs: ['history'],
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
		needs: ['history'],
		act: async ({ store }) => {
			await store.registerDocument(makeDocument({ id: 'b' }))
			await store.bulkWrite('b', { creates: [makeRecord({ id: 'rb' })] })
			await store.registerDocument(makeDocument({ id: 'a', status: 'importing' }))
			await store.bulkWrite('a', { creates: [makeRecord({ id: 'a1' })] })

			await commit({
				store,
				documentId: 'b',
				updates: [makeRecord({ id: 'rb', value: 'edited' })],
			})

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
			await store.registerDocument(makeDocument({ id: 'a', status: 'importing' }))
			await store.bulkWrite('a', { creates: [makeRecord({ id: 'a1' })] })
			expect((await store.getDocuments()).map((document) => document.status)).toEqual(['importing'])
			expect(await store.count('a')).toBe(1)
			await store.updateDocument('a', { status: 'ready' })
			expect(await store.getDocument('a')).toEqual(makeDocument({ id: 'a' }))
		},
	},
}

// ── Importing a file ─────────────────────────────────────────────────────────

/** A ready document `kept` with one record: what an import must leave as it was. */
async function seedKeptDocument(store: Store): Promise<void> {
	await store.registerDocument(makeDocument({ id: 'kept' }))
	await store.bulkWrite('kept', { creates: [makeRecord({ id: 'k1' })] })
}

/** Nothing of an import remains: the kept document alone, as it was, and the import not applied. */
async function expectOnlyKeptDocument(params: { store: Store; writeId: string }): Promise<void> {
	const { store, writeId } = params
	expect((await store.getDocuments()).map((document) => document.id)).toEqual(['kept'])
	expect(await store.getByDocumentId('kept')).toEqual([makeRecord({ id: 'k1' })])
	expect(await store.getWriteOutcome({ writeId })).toBe('not-applied')
}

/** A failing import, and the structured error it must be refused with. */
type FailingImport = {
	file: File
	key: 'PARSE_ERROR' | 'IMPORT_FAILED' | 'STORE_VALUE_NOT_JSON'
	detail: RegExp
}

const failingImports: Record<string, FailingImport> = {
	'a truncated file is refused PARSE_ERROR': {
		file: contractFile({ body: `<A>${sessionRecords(3)}`, truncated: true }),
		key: 'PARSE_ERROR',
		detail: /unclosed/i,
	},
	'a session that throws is refused IMPORT_FAILED with its error': {
		file: contractFile({ body: `${sessionRecords(2)}<B aB="x" bB="fail"/>` }),
		key: 'IMPORT_FAILED',
		detail: /the contract session fails/,
	},
	'a session saying a diagnostic that is not JSON (a function in its meta) is refused STORE_VALUE_NOT_JSON':
		{
			file: contractFile({
				body: `${sessionRecords(2)}<B aB="x" bB="${CONTRACT_SESSION_FUNCTION_VALUE}"/>`,
			}),
			key: 'STORE_VALUE_NOT_JSON',
			detail: /^A diagnostic of the import session: a function is not a JSON value \(field "fix"\)/,
		},
	'a session saying a diagnostic holding text that is not well-formed is refused STORE_VALUE_NOT_JSON':
		{
			file: contractFile({
				body: `${sessionRecords(2)}<B aB="x" bB="${CONTRACT_SESSION_LONE_SURROGATE_VALUE}"/>`,
			}),
			key: 'STORE_VALUE_NOT_JSON',
			detail:
				/^A diagnostic of the import session: text that is not well-formed UTF-16 \(a lone surrogate\) is not a JSON value \(field "note"\)/,
		},
}

const importing: StoreContractCases = {
	'an import answers the ready document, its record count and its session diagnostics': {
		needs: ['import'],
		act: async ({ store }) => {
			const result = await store.importFile({
				file: contractFile({ body: `<A/>${sessionRecords(2)}`, name: 'plant.xml' }),
				options: { metadata: { origin: 'test' } },
				writeId: 'w-1',
			})
			expect(result.record).toEqual({
				id: expect.any(String),
				name: 'plant',
				extension: '.xml',
				configKey: 'default',
				createdAt: expect.any(Number),
				metadata: { origin: 'test' },
				status: 'ready',
				writeId: 'w-1',
			})
			expect(await store.getDocument(result.record.id)).toEqual(result.record)
			expect(result.recordCount).toBe(4)
			expect(await store.count(result.record.id)).toBe(4)
			const handed = await store.getByTagNameInDocument(CONTRACT_SESSION_TAG, result.record.id)
			expect(result.diagnostics).toHaveLength(2)
			expect(result.diagnostics).toEqual(
				expect.arrayContaining(
					handed.map((record) => ({
						code: 'seen',
						severity: 'information',
						source: CONTRACT_SESSION_DIAGNOSTICS.source,
						message: CONTRACT_SESSION_DIAGNOSTICS.codes.seen.message,
						ref: { tagName: CONTRACT_SESSION_TAG, id: record.id },
						meta: { ancestry: ['Root'] },
					})),
				),
			)
		},
	},
	'the session is handed the records of the tags it asks for only, with their open ancestors': {
		needs: ['import'],
		act: async ({ store }) => {
			const result = await store.importFile({
				file: contractFile({ body: '<A><B aB="deep"/></A><C/><B aB="top"/>' }),
			})
			expect(result.diagnostics.map((diagnostic) => diagnostic.meta)).toEqual([
				{ ancestry: ['Root', 'A'] },
				{ ancestry: ['Root'] },
			])
		},
	},
	'the writes of the session are stored before the document is ready': {
		needs: ['import'],
		act: async ({ store }) => {
			const result = await store.importFile({ file: contractFile({ body: sessionRecords(2) }) })
			const handed = await store.getByTagNameInDocument(CONTRACT_SESSION_TAG, result.record.id)
			expect(handed).toHaveLength(2)
			for (const record of handed) {
				expect(record.attributes).toContainEqual({
					name: CONTRACT_SESSION_SEEN_ATTRIBUTE,
					value: 'yes',
				})
			}
		},
	},
	...Object.fromEntries(
		Object.entries(failingImports).map(([description, failing]) => [
			`${description}, and leaves nothing: the documents there stay as they were`,
			{
				needs: ['import'],
				act: async ({ store }: StoreContractContext) => {
					await seedKeptDocument(store)
					await expectRejectsWith({
						action: store.importFile({
							file: failing.file,
							options: { chunkOptions: SMALL_BATCHES },
							writeId: 'w-failed',
						}),
						key: failing.key,
						detail: failing.detail,
					})
					await expectOnlyKeptDocument({ store, writeId: 'w-failed' })
				},
			},
		]),
	),
	'progress is told after each batch, with its phase, the bytes read growing to the size of the file':
		{
			needs: ['import'],
			act: async ({ store }) => {
				const file = contractFile({ body: sessionRecords(4) })
				const progress: ImportProgress[] = []
				await store.importFile({
					file,
					options: { chunkOptions: SMALL_BATCHES },
					onProgress: (step) => progress.push(step),
				})
				// a store that builds indexes says so between batches (`indexing`); one that builds none never does
				expect(progress.every((step) => ['storing', 'indexing'].includes(step.phase))).toBe(true)
				const storing = progress.filter((step) => step.phase === 'storing')
				expect(storing.length).toBeGreaterThan(1)
				const bytes = storing.map((step) => step.bytesRead)
				expect(bytes).toEqual([...bytes].sort((left, right) => left - right))
				expect(progress.every((step) => step.totalBytes === file.size)).toBe(true)
				expect(progress.at(-1)).toEqual({
					phase: 'storing',
					bytesRead: file.size,
					totalBytes: file.size,
				})
			},
		},
	'a progress listener that never answers, rejects or throws neither holds nor fails the import': {
		needs: ['import'],
		act: async ({ store }) => {
			const listeners: ((progress: ImportProgress) => unknown)[] = [
				() => new Promise(() => {}),
				() => Promise.reject(new Error('listener gone')),
				() => {
					throw new Error('listener broken')
				},
			]
			for (const listener of listeners) {
				const result = await store.importFile({
					file: contractFile({ body: sessionRecords(2) }),
					options: { chunkOptions: SMALL_BATCHES },
					onProgress: listener,
				})
				expect(result.record.status).toBe('ready')
			}
		},
	},
	'an import aborted while it runs is refused IMPORT_ABORTED and leaves nothing': {
		needs: ['import'],
		act: async ({ store }) => {
			await seedKeptDocument(store)
			const controller = new AbortController()
			await expectRejectsWith({
				action: store.importFile({
					file: contractFile({ body: sessionRecords(6) }),
					options: { chunkOptions: SMALL_BATCHES },
					writeId: 'w-aborted',
					onProgress: () => controller.abort(),
					signal: controller.signal,
				}),
				key: 'IMPORT_ABORTED',
			})
			await expectOnlyKeptDocument({ store, writeId: 'w-aborted' })
		},
	},
	'an import aborted before it starts is refused IMPORT_ABORTED and registers nothing': {
		needs: ['import'],
		act: async ({ store }) => {
			await seedKeptDocument(store)
			await expectRejectsWith({
				action: store.importFile({
					file: contractFile({ body: sessionRecords(1) }),
					writeId: 'w-aborted',
					signal: AbortSignal.abort(),
				}),
				key: 'IMPORT_ABORTED',
			})
			await expectOnlyKeptDocument({ store, writeId: 'w-aborted' })
		},
	},
	'an import left unfinished is removed when the store opens; a ready document stays': {
		act: async ({ store, reopen }) => {
			await seedKeptDocument(store)
			await store.registerDocument(
				makeDocument({ id: 'left', status: 'importing', writeId: 'w-left' }),
			)
			await store.bulkWrite('left', { creates: [makeRecord({ id: 'l1' })] })
			const reopened = await reopen()
			await expectOnlyKeptDocument({ store: reopened, writeId: 'w-left' })
			expect(await reopened.getByDocumentId('left')).toEqual([])
		},
	},
	'the outcome of an import asked by its id: running while it runs, applied once ready': {
		needs: ['import'],
		act: async ({ store }) => {
			let whileRunning: Promise<WriteOutcome> | undefined
			await store.importFile({
				// several batches still to store when the outcome is asked at the first one
				file: contractFile({ body: sessionRecords(8) }),
				options: { chunkOptions: SMALL_BATCHES },
				writeId: 'w-running',
				onProgress: () => {
					whileRunning ??= store.getWriteOutcome({ writeId: 'w-running' })
				},
			})
			expect(await whileRunning).toBe('running')
			expect(await store.getWriteOutcome({ writeId: 'w-running' })).toBe('applied')
		},
	},
	'the outcome of a write is read from the document carrying its id: importing → running, ready → applied':
		{
			act: async ({ store }) => {
				await store.registerDocument(makeDocument({ id: 'a', status: 'importing', writeId: 'w-a' }))
				await store.registerDocument(makeDocument({ id: 'b', writeId: 'w-b' }))
				expect(await store.getWriteOutcome({ writeId: 'w-a' })).toBe('running')
				expect(await store.getWriteOutcome({ writeId: 'w-b' })).toBe('applied')
			},
		},
	'the outcome of an id no import carried is not-applied': {
		act: async ({ store }) => {
			expect(await store.getWriteOutcome({ writeId: 'never' })).toBe('not-applied')
		},
	},
	'the importing document removed through another connection, a new one registered → DOCUMENT_NOT_REGISTERED, not applied; the new one untouched':
		{
			needs: ['second-connection', 'import'],
			act: async ({ store, connect }) => {
				const other = await connect()
				const hold = holdContractImport()
				const importing = store.importFile({
					file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
					writeId: 'w-held',
				})
				try {
					await untilHeld({ hold, importing })
					const [imported] = await other.getDocuments()
					await other.removeDocument(imported!.id)
					expect(await other.getWriteOutcome({ writeId: 'w-held' })).toBe('not-applied')
					await other.registerDocument(makeDocument({ id: 'new' }))
					await other.bulkWrite('new', { creates: [makeRecord({ id: 'n1' })] })
					hold.release()
					await expectRejectsWith({ action: importing, key: 'DOCUMENT_NOT_REGISTERED' })
					expect(await other.getByDocumentId('new')).toEqual([makeRecord({ id: 'n1' })])
					expect((await other.getDocuments()).map((document) => document.id)).toEqual(['new'])
					expect(await other.getWriteOutcome({ writeId: 'w-held' })).toBe('not-applied')
				} finally {
					hold.release()
					await importing.catch(() => undefined)
				}
			},
		},
	'a write through another connection while an import runs → kept when the import then fails': {
		needs: ['second-connection', 'import'],
		act: async ({ store, connect }) => {
			const other = await connect()
			const hold = holdContractImport()
			const importing = store.importFile({
				file: contractFile({
					body:
						`<B aB="B0" bB="${hold.value}"/>` + `<B aB="B1" bB="${CONTRACT_SESSION_FAIL_VALUE}"/>`,
				}),
				writeId: 'w-failing',
			})
			try {
				await untilHeld({ hold, importing })
				await other.registerDocument(makeDocument({ id: 'written' }))
				await other.bulkWrite('written', { creates: [makeRecord({ id: 'w1' })] })
				hold.release()
				await expectRejectsWith({ action: importing, key: 'IMPORT_FAILED' })
				expect((await store.getDocuments()).map((document) => document.id)).toEqual(['written'])
				expect(await store.getByDocumentId('written')).toEqual([makeRecord({ id: 'w1' })])
			} finally {
				hold.release()
				await importing.catch(() => undefined)
			}
		},
	},
	'a commit, its undo and its redo through another connection while an import runs → kept when the import then fails':
		{
			needs: ['second-connection', 'import', 'history'],
			act: async ({ store, connect }) => {
				await store.registerDocument(makeDocument({ id: 'edited' }))
				const other = await connect()
				const hold = holdContractImport()
				const importing = store.importFile({
					file: contractFile({
						body:
							`<B aB="B0" bB="${hold.value}"/>` +
							`<B aB="B1" bB="${CONTRACT_SESSION_FAIL_VALUE}"/>`,
					}),
					writeId: 'w-failing',
				})
				try {
					await untilHeld({ hold, importing })
					await commit({
						store: other,
						documentId: 'edited',
						writeId: 'w-commit',
						creates: [makeRecord({ id: 'e1' }), makeRecord({ id: 'e2' })],
					})
					await other.undo('edited')
					await other.redo('edited')
					hold.release()
					await expectRejectsWith({ action: importing, key: 'IMPORT_FAILED' })
					expect((await store.getDocuments()).map((document) => document.id)).toEqual(['edited'])
					expect((await store.getByDocumentId('edited')).map((record) => record.id)).toEqual([
						'e1',
						'e2',
					])
					expect(await store.getWriteOutcome({ writeId: 'w-commit' })).toBe('applied')
					await store.undo('edited')
					expect(await store.getByDocumentId('edited')).toEqual([])
				} finally {
					hold.release()
					await importing.catch(() => undefined)
				}
			},
		},
	'a file giving one of its own ids twice → STORE_DUPLICATE_ID naming it, and leaves nothing': {
		needs: ['import'],
		act: async ({ store }) => {
			await seedKeptDocument(store)
			const withId = `xmlns:${DIALECTE_DEV_NAMESPACE.prefix}="${DIALECTE_DEV_NAMESPACE.uri}" ${CUSTOM_RECORD_ID_ATTRIBUTE}="twice"`
			const thrown = await store
				.importFile({
					file: contractFile({ body: `<A ${withId}/><C ${withId}/>` }),
					options: { useCustomRecordsIds: true, chunkOptions: SMALL_BATCHES },
					writeId: 'w-twice',
				})
				.then(
					() => undefined,
					(error: unknown) => error,
				)
			const error = toDialecteError(thrown)
			expect(error?.key).toBe('STORE_DUPLICATE_ID')
			expect(error?.meta?.recordIds).toContain('twice')
			await expectOnlyKeptDocument({ store, writeId: 'w-twice' })
		},
	},
	'with perf on, the import hands back the timings of its stages': {
		needs: ['import'],
		act: async ({ store }) => {
			const result = await store.importFile({ file: contractFile({ body: sessionRecords(2) }) })
			expect(result.perf?.timeOrigin).toEqual(expect.any(Number))
			const spanNames = new Set(result.perf?.spans.map((span) => span.name))
			for (const stage of [
				'import',
				'import::register',
				'import::insert',
				'import::hooks.after',
				'import::writes.after',
				'import::finalize',
			]) {
				expect(spanNames, stage).toContain(stage)
			}
			for (const stage of [
				'import::decode',
				'import::parse',
				'import::standardize',
				'import::hooks.record',
			]) {
				expect(result.perf?.totals[stage]?.calls, stage).toBeGreaterThan(0)
			}
		},
	},
}

// ── One state for every connection ───────────────────────────────────────────

const oneState: StoreContractCases = {
	'a document registered and written through one connection is read through another': {
		needs: ['second-connection'],
		act: async ({ store, connect }) => {
			const other = await connect()
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			expect(await other.getDocument('doc-1')).toEqual(makeDocument())
			expect((await other.getByDocumentId('doc-1')).map((record) => record.id)).toEqual(['r1'])
		},
	},
	'a document removed through one connection is gone through another': {
		needs: ['second-connection'],
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
		needs: ['second-connection', 'history'],
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
		needs: ['second-connection'],
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

const oneStateAfterDestroy: StoreContractCases = {
	'destroy through one connection → the other reads empty; what it registers then, a new connection reads':
		{
			needs: ['second-connection'],
			act: async ({ store, connect }) => {
				await store.registerDocument(makeDocument())
				await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
				const other = await connect()
				await store.destroy()
				expect(await other.getDocuments()).toEqual([])
				expect(await other.get('r1', 'doc-1')).toBeUndefined()
				await other.registerDocument(makeDocument({ id: 'doc-2' }))
				const fresh = await connect()
				expect((await fresh.getDocuments()).map((document) => document.id)).toEqual(['doc-2'])
			},
		},
	'an import running through one connection → kept when another connection opens, applied once done':
		{
			needs: ['second-connection', 'import'],
			act: async ({ store, connect }) => {
				const hold = holdContractImport()
				const importing = store.importFile({
					file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
					writeId: 'w-held',
				})
				try {
					await untilHeld({ hold, importing })
					const other = await connect()
					hold.release()
					const result = await importing
					expect(await other.getWriteOutcome({ writeId: 'w-held' })).toBe('applied')
					expect(await other.count(result.record.id)).toBe(2)
				} finally {
					// a failure above must not leave the import waiting for the rest of the worker
					hold.release()
					await importing.catch(() => undefined)
				}
			},
		},
}

// ── Stores of other names ────────────────────────────────────────────────────

const otherNames: StoreContractCases = {
	'two stores of other names holding the same ids → neither sees the other’s records, documents or removal':
		{
			act: async ({ store, createOther }) => {
				const other = await createOther()
				await store.registerDocument(makeDocument())
				await other.registerDocument(makeDocument())
				await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
				await other.bulkWrite('doc-1', {
					creates: [makeRecord({ id: 'r1', attributes: [{ name: 'a', value: '2' }] })],
				})
				expect(await store.get('r1', 'doc-1')).toEqual(makeRecord({ id: 'r1' }))
				await other.removeDocument('doc-1')
				expect((await store.getDocuments()).map((document) => document.id)).toEqual(['doc-1'])
				expect(await store.count('doc-1')).toBe(1)
			},
		},
}

// ── List reads in id order ───────────────────────────────────────────────────

/** Ids handed to the store out of id order: every list read must answer them sorted. */
const UNORDERED_IDS = ['z', 'b', 'm', 'a']
const ID_ORDER = ['a', 'b', 'm', 'z']

/** A list read and the ids of what it answers, after its subject was written in `UNORDERED_IDS` order. */
const ORDERED_READS: Record<string, OrderedRead> = {
	getByDocumentId: {
		read: async (store) => {
			await store.registerDocument(makeDocument())
			for (const id of UNORDERED_IDS)
				await store.bulkWrite('doc-1', { creates: [makeRecord({ id })] })
			return (await store.getByDocumentId('doc-1')).map((record) => record.id)
		},
	},
	getByTagNameInDocument: {
		read: async (store) => {
			await store.registerDocument(makeDocument())
			for (const id of UNORDERED_IDS)
				await store.bulkWrite('doc-1', { creates: [makeRecord({ id })] })
			return (await store.getByTagNameInDocument('A', 'doc-1')).map((record) => record.id)
		},
	},
	getDocuments: {
		read: async (store) => {
			for (const id of UNORDERED_IDS) await store.registerDocument(makeDocument({ id }))
			return (await store.getDocuments()).map((document) => document.id)
		},
	},
	getBlobsByDocument: {
		needs: ['blobs'],
		read: async (store) => {
			await store.registerDocument(makeDocument())
			for (const id of UNORDERED_IDS) {
				const attachedTo = [{ documentId: 'doc-1', recordRef: 'r1' }]
				await store.addBlob(makeBlobEntry({ id, attachedTo }), new Blob([id]))
			}
			return (await store.getBlobsByDocument('doc-1')).map((entry) => entry.id)
		},
	},
	getBlobsByRecord: {
		needs: ['blobs'],
		read: async (store) => {
			await store.registerDocument(makeDocument())
			for (const id of UNORDERED_IDS) {
				const attachedTo = [{ documentId: 'doc-1', recordRef: 'r1' }]
				await store.addBlob(makeBlobEntry({ id, attachedTo }), new Blob([id]))
			}
			return (await store.getBlobsByRecord('doc-1', 'r1')).map((entry) => entry.id)
		},
	},
	getStandaloneBlobs: {
		needs: ['blobs'],
		read: async (store) => {
			await store.registerDocument(makeDocument())
			for (const id of UNORDERED_IDS) await store.addBlob(makeBlobEntry({ id }), new Blob([id]))
			return (await store.getStandaloneBlobs()).map((entry) => entry.id)
		},
	},
}

const idOrder: StoreContractCases = Object.fromEntries(
	Object.entries(ORDERED_READS).map(([name, { needs, read }]) => [
		`${name}: written out of id order → answered in id order`,
		{
			needs,
			act: async ({ store }: StoreContractContext) => expect(await read(store)).toEqual(ID_ORDER),
		},
	]),
)

// ── Records are values ───────────────────────────────────────────────────────

/** A document with a parent and a child, one commit and one update in its history, two blobs. */
async function seedValues(store: Store): Promise<void> {
	await store.registerDocument(makeDocument({ metadata: { origin: { kind: 'seed' } } }))
	await commit({
		store,
		documentId: 'doc-1',
		creates: [
			makeRecord({ id: 'r1', children: [childRef('r2')] }),
			makeRecord({ id: 'r2', parent: childRef('r1') }),
		],
	})
	await commit({
		store,
		documentId: 'doc-1',
		updates: [
			makeRecord({ id: 'r1', attributes: [{ name: 'a', value: '2' }], children: [childRef('r2')] }),
		],
	})
	await store.addBlob(
		makeBlobEntry({ id: 'b-attached', attachedTo: [{ documentId: 'doc-1', recordRef: 'r1' }] }),
		new Blob(['attached']),
	)
	await store.addBlob(makeBlobEntry({ id: 'b-standalone' }), new Blob(['standalone']))
}

const VALUE_READS: Record<string, ValueRead> = {
	get: (store) => store.get('r1', 'doc-1'),
	getByDocumentId: (store) => store.getByDocumentId('doc-1'),
	getByTagNameInDocument: (store) => store.getByTagNameInDocument('A', 'doc-1'),
	getMany: (store) => store.getMany(['r1', 'r2'], 'doc-1'),
	getDocument: (store) => store.getDocument('doc-1'),
	getDocuments: (store) => store.getDocuments(),
	getChangeLog: (store) => store.getChangeLog('doc-1'),
	getBlob: (store) => store.getBlob('b-attached'),
	getBlobsByDocument: (store) => store.getBlobsByDocument('doc-1'),
	getBlobsByRecord: (store) => store.getBlobsByRecord('doc-1', 'r1'),
	getStandaloneBlobs: (store) => store.getStandaloneBlobs(),
}

/** Undo then redo the last commit, then read the record `id`: what the history holds of it. */
async function throughHistory(params: { store: Store; id: string }): Promise<unknown> {
	const { store, id } = params
	await store.undo('doc-1')
	await store.redo('doc-1')
	return store.get(id, 'doc-1')
}

const VALUE_WRITES: Record<string, ValueWrite> = {
	'bulkWrite creates': {
		given: () => [makeRecord({ id: 'r9', children: [childRef('r2')] })],
		write: ({ store, given }) => store.bulkWrite('doc-1', { creates: given as AnyRawRecord[] }),
		read: (store) => store.get('r9', 'doc-1'),
	},
	'bulkWrite update patch': {
		given: () => [
			{ recordId: 'r2', attributes: [{ name: 'b', value: '2' }], children: [childRef('r9')] },
		],
		write: ({ store, given }) => store.bulkWrite('doc-1', { updates: given as RecordPatch[] }),
		read: (store) => store.get('r2', 'doc-1'),
	},
	'commit creates': {
		given: () => [makeRecord({ id: 'r9', children: [childRef('r2')] })],
		write: ({ store, given }) =>
			commit({ store, documentId: 'doc-1', creates: given as AnyRawRecord[] }),
		read: (store) => store.get('r9', 'doc-1'),
	},
	'commit creates, read through undo and redo': {
		given: () => [makeRecord({ id: 'r9', children: [childRef('r2')] })],
		write: ({ store, given }) =>
			commit({ store, documentId: 'doc-1', creates: given as AnyRawRecord[] }),
		read: (store) => throughHistory({ store, id: 'r9' }),
	},
	'commit creates, read through the changelog': {
		given: () => [makeRecord({ id: 'r9', children: [childRef('r2')] })],
		write: ({ store, given }) =>
			commit({ store, documentId: 'doc-1', creates: given as AnyRawRecord[] }),
		read: (store) => store.getChangeLog('doc-1'),
	},
	'commit updates': {
		given: () => [
			makeRecord({ id: 'r2', attributes: [{ name: 'a', value: '3' }], parent: childRef('r1') }),
		],
		write: ({ store, given }) =>
			commit({ store, documentId: 'doc-1', updates: given as AnyRawRecord[] }),
		read: (store) => store.get('r2', 'doc-1'),
	},
	'commit updates, read through undo and redo': {
		given: () => [
			makeRecord({ id: 'r2', attributes: [{ name: 'a', value: '3' }], parent: childRef('r1') }),
		],
		write: ({ store, given }) =>
			commit({ store, documentId: 'doc-1', updates: given as AnyRawRecord[] }),
		read: (store) => throughHistory({ store, id: 'r2' }),
	},
	registerDocument: {
		given: () => makeDocument({ id: 'doc-3', metadata: { origin: { kind: 'given' } } }),
		write: ({ store, given }) => store.registerDocument(given as DocumentRecord),
		read: (store) => store.getDocument('doc-3'),
	},
	updateDocument: {
		given: () => ({ metadata: { origin: { kind: 'updated' } } }),
		write: ({ store, given }) => store.updateDocument('doc-1', given as Partial<DocumentRecord>),
		read: (store) => store.getDocument('doc-1'),
	},
	addBlob: {
		given: () =>
			makeBlobEntry({ id: 'b9', attachedTo: [{ documentId: 'doc-1', recordRef: 'r2' }] }),
		write: ({ store, given }) => store.addBlob(given as BlobRecord, new Blob(['given'])),
		read: async (store) => (await store.getBlob('b9'))?.entry,
	},
	attachBlob: {
		given: () => ({ documentId: 'doc-1', recordRef: 'r2', attribute: 'a' }),
		write: ({ store, given }) => store.attachBlob('b-attached', given as BlobAttachment),
		read: async (store) => (await store.getBlob('b-attached'))?.entry,
	},
}

const values: StoreContractCases = {
	...Object.fromEntries(
		Object.entries(VALUE_READS).map(([name, read]) => [
			`${name}: the caller changes what it read → the next ${name} answers as before`,
			{
				act: async ({ store }: StoreContractContext) => {
					await seedValues(store)
					const first = await read(store)
					const asRead = structuredClone(first)
					scribble(first)
					expect(await read(store)).toEqual(asRead)
				},
			},
		]),
	),
	...Object.fromEntries(
		Object.entries(VALUE_WRITES).map(([name, { given, write, read }]) => [
			`${name}: the caller changes what it handed the store → the store keeps what was written`,
			{
				act: async ({ store }: StoreContractContext) => {
					await seedValues(store)
					const handed = given()
					await write({ store, given: handed })
					const asWritten = structuredClone(await read(store))
					scribble(handed)
					expect(await read(store)).toEqual(asWritten)
				},
			},
		]),
	),
}

// ── A closed store ───────────────────────────────────────────────────────────

/** Every operation of the port but the lifecycle ones; through a closed store each is refused. */
const OPERATIONS_ON_A_CLOSED_STORE: Record<string, StoreOperation> = {
	reconcile: (store) => store.reconcile(),
	isDocumentReadable: (store) => store.isDocumentReadable('doc-1'),
	registerDocument: (store) => store.registerDocument(makeDocument({ id: 'doc-2' })),
	getDocument: (store) => store.getDocument('doc-1'),
	getDocuments: (store) => store.getDocuments(),
	updateDocument: (store) => store.updateDocument('doc-1', { name: 'renamed' }),
	removeDocument: (store) => store.removeDocument('doc-1'),
	get: (store) => store.get('r1', 'doc-1'),
	getByDocumentId: (store) => store.getByDocumentId('doc-1'),
	count: (store) => store.count('doc-1'),
	getByTagNameInDocument: (store) => store.getByTagNameInDocument('A', 'doc-1'),
	getMany: (store) => store.getMany(['r1'], 'doc-1'),
	importFile: (store) => store.importFile({ file: contractFile({ body: sessionRecords(1) }) }),
	getWriteOutcome: (store) => store.getWriteOutcome({ writeId: 'w-any' }),
	exportFile: (store) => store.exportFile({ documentId: 'doc-1' }),
	bulkWrite: (store) => store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r9' })] }),
	commit: (store) => commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r9' })] }),
	undo: (store) => store.undo('doc-1'),
	redo: (store) => store.redo('doc-1'),
	getHistoryStatus: (store) => store.getHistoryStatus('doc-1'),
	getChangeLog: (store) => store.getChangeLog('doc-1'),
	addBlob: (store) => store.addBlob(makeBlobEntry({ id: 'b9' }), new Blob(['b9'])),
	getBlob: (store) => store.getBlob('b1'),
	getBlobsByDocument: (store) => store.getBlobsByDocument('doc-1'),
	getBlobsByRecord: (store) => store.getBlobsByRecord('doc-1', 'r1'),
	getStandaloneBlobs: (store) => store.getStandaloneBlobs(),
	attachBlob: (store) => store.attachBlob('b1', { documentId: 'doc-1', recordRef: 'r1' }),
	detachBlob: (store) => store.detachBlob('b1', { documentId: 'doc-1', recordRef: 'r1' }),
	removeBlob: (store) => store.removeBlob('b1'),
}

/** A document with one record, one commit in its history and one blob: what a closed store keeps. */
async function seedClosedStore(store: Store): Promise<void> {
	await store.registerDocument(makeDocument())
	await commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r1' })] })
	await store.addBlob(makeBlobEntry({ id: 'b1' }), new Blob(['b1']))
}

/** Operations that span several steps of a store, each running when `close()` is called. */
const OPERATIONS_IN_FLIGHT: Record<string, OperationInFlight> = {
	registerDocument: {
		run: (store) => store.registerDocument(makeDocument({ id: 'doc-2' })),
		expected: async (store) =>
			expect((await store.getDocuments()).map((document) => document.id)).toEqual([
				'doc-1',
				'doc-2',
			]),
	},
	removeDocument: {
		run: (store) => store.removeDocument('doc-1'),
		expected: async (store) => expect(await store.getDocuments()).toEqual([]),
	},
	bulkWrite: {
		run: (store) => store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r9' })] }),
		expected: async (store) =>
			expect(await store.get('r9', 'doc-1')).toEqual(makeRecord({ id: 'r9' })),
	},
	commit: {
		run: (store) => commit({ store, documentId: 'doc-1', creates: [makeRecord({ id: 'r9' })] }),
		expected: async (store) =>
			expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: true, canRedo: false }),
	},
	undo: {
		run: (store) => store.undo('doc-1'),
		expected: async (store) => expect(await store.get('r1', 'doc-1')).toBeUndefined(),
	},
	getByDocumentId: {
		run: async (store) =>
			expect(await store.getByDocumentId('doc-1')).toEqual([makeRecord({ id: 'r1' })]),
		expected: async () => {},
	},
	addBlob: {
		run: (store) => store.addBlob(makeBlobEntry({ id: 'b9' }), new Blob(['b9'])),
		expected: async (store) => expect((await store.getBlob('b9'))?.entry.id).toBe('b9'),
	},
}

const closedStore: StoreContractCases = {
	...Object.fromEntries(
		Object.entries(OPERATIONS_IN_FLIGHT).map(([name, { run, expected }]) => [
			`${name} running when the store is closed → it completes; a later operation is refused`,
			{
				needs: ['history', 'blobs'],
				act: async ({ store }: StoreContractContext) => {
					await seedClosedStore(store)
					const running = run(store)
					store.close()
					await running
					await expectRejectsWith({
						action: store.getDocuments(),
						key: 'STORE_CLOSED',
						meta: { storeName: store.name },
					})
					await store.open()
					await expected(store)
				},
			},
		]),
	),
	...Object.fromEntries(
		Object.entries(OPERATIONS_IN_FLIGHT).map(([name, { run, expected }]) => [
			`${name} running when the store is closed and opened again at once → it completes, then the store opens`,
			{
				needs: ['history', 'blobs'],
				act: async ({ store }: StoreContractContext) => {
					await seedClosedStore(store)
					const running = run(store)
					store.close()
					const opening = store.open()
					await running
					await opening
					await expected(store)
				},
			},
		]),
	),
	...Object.fromEntries(
		Object.entries(OPERATIONS_IN_FLIGHT).map(([name, { run }]) => [
			`${name} running when the store is destroyed → it completes, then the name reads empty`,
			{
				needs: ['history', 'blobs'],
				act: async ({ store, reopen }: StoreContractContext) => {
					await seedClosedStore(store)
					const running = run(store)
					const destroying = store.destroy()
					await running
					await destroying
					const reopened = await reopen()
					expect(await reopened.getDocuments()).toEqual([])
				},
			},
		]),
	),
	'an import running when the store is destroyed → it completes, then the name reads empty': {
		needs: ['import'],
		act: async ({ store, reopen }) => {
			const hold = holdContractImport()
			const importing = store.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
				writeId: 'w-held',
			})
			try {
				await untilHeld({ hold, importing })
				const destroying = store.destroy()
				hold.release()
				await importing
				await destroying
				const reopened = await reopen()
				expect(await reopened.getDocuments()).toEqual([])
			} finally {
				hold.release()
				await importing.catch(() => undefined)
			}
		},
	},
	'an import running when the store is closed → it completes; reopened, its document is there': {
		needs: ['import'],
		act: async ({ store }) => {
			const hold = holdContractImport()
			const importing = store.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
				writeId: 'w-held',
			})
			try {
				await untilHeld({ hold, importing })
				store.close()
				await expectRejectsWith({ action: store.getDocuments(), key: 'STORE_CLOSED' })
				hold.release()
				const result = await importing
				await store.open()
				expect(await store.getWriteOutcome({ writeId: 'w-held' })).toBe('applied')
				expect(await store.count(result.record.id)).toBe(2)
			} finally {
				hold.release()
				await importing.catch(() => undefined)
			}
		},
	},
	...Object.fromEntries(
		Object.entries(OPERATIONS_ON_A_CLOSED_STORE).map(([name, operation]) => [
			`${name} through a closed store → STORE_CLOSED; opened again, the store as it was`,
			{
				needs: ['history', 'blobs'],
				act: async ({ store }: StoreContractContext) => {
					await seedClosedStore(store)
					store.close()
					await expectRejectsWith({
						action: operation(store),
						key: 'STORE_CLOSED',
						meta: { storeName: store.name },
					})
					await store.open()
					expect((await store.getDocuments()).map((document) => document.id)).toEqual(['doc-1'])
					expect(await store.getByDocumentId('doc-1')).toEqual([makeRecord({ id: 'r1' })])
					expect(await store.getHistoryStatus('doc-1')).toEqual({ canUndo: true, canRedo: false })
					expect((await store.getStandaloneBlobs()).map((entry) => entry.id)).toEqual(['b1'])
				},
			},
		]),
	),
	'open() then close() at once → the store ends closed: the open refused, the next operation too': {
		needs: ['history', 'blobs'],
		act: async ({ store }) => {
			await seedClosedStore(store)
			store.close()
			const opening = store.open()
			store.close()
			await expectRejectsWith({ action: opening, key: 'STORE_CLOSED' })
			await expectRejectsWith({ action: store.getDocuments(), key: 'STORE_CLOSED' })
			await store.open()
			expect((await store.getDocuments()).map((document) => document.id)).toEqual(['doc-1'])
		},
	},
	'a closed store closed again → nothing thrown; destroyed → the name reopens empty': {
		needs: ['history', 'blobs'],
		act: async ({ store, reopen }) => {
			await seedClosedStore(store)
			store.close()
			expect(() => store.close()).not.toThrow()
			await store.destroy()
			const reopened = await reopen()
			expect(await reopened.getDocuments()).toEqual([])
		},
	},
	'one connection closed → another connection of the name reads and writes on': {
		needs: ['second-connection', 'history', 'blobs'],
		act: async ({ store, connect }) => {
			await seedClosedStore(store)
			const other = await connect()
			store.close()
			await other.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r2' })] })
			expect((await other.getByDocumentId('doc-1')).map((record) => record.id)).toEqual([
				'r1',
				'r2',
			])
		},
	},
}

/** Every case of the table, needing `needs` besides what it needs itself. */
export function needing(params: {
	needs: StoreContractNeed[]
	cases: StoreContractCases
}): StoreContractCases {
	const { needs, cases } = params
	return Object.fromEntries(
		Object.entries(cases).map(([description, testCase]) => [
			description,
			{ ...testCase, needs: [...new Set([...(testCase.needs ?? []), ...needs])] },
		]),
	)
}

/** A write the store's storage has no room for: refused whole, as running out of space. */
const fullStorage: StoreContractCases = {
	'a commit the storage has no room for → STORE_QUOTA_EXCEEDED, nothing of it applied': {
		needs: ['full-storage'],
		act: async (context) => {
			await context.store.registerDocument(makeDocument())
			await context.fillStorage()
			await expectRejectsWith({
				action: commit({
					store: context.store,
					documentId: 'doc-1',
					creates: Array.from({ length: 2_000 }, (_, index) =>
						makeRecord({ id: `r${index}`, value: 'x'.repeat(200) }),
					),
				}),
				key: 'STORE_QUOTA_EXCEEDED',
			})
			expect(await context.store.count('doc-1')).toBe(0)
		},
	},
	'a bulk write the storage has no room for → STORE_QUOTA_EXCEEDED, nothing of it applied': {
		needs: ['full-storage'],
		act: async (context) => {
			await context.store.registerDocument(makeDocument())
			await context.fillStorage()
			await expectRejectsWith({
				action: context.store.bulkWrite('doc-1', {
					creates: Array.from({ length: 2_000 }, (_, index) =>
						makeRecord({ id: `r${index}`, value: 'x'.repeat(200) }),
					),
				}),
				key: 'STORE_QUOTA_EXCEEDED',
			})
			expect(await context.store.count('doc-1')).toBe(0)
		},
	},
	'a document the storage has no room to register → STORE_QUOTA_EXCEEDED, not registered': {
		needs: ['full-storage'],
		act: async (context) => {
			await context.fillStorage()
			await expectRejectsWith({
				// metadata larger than what the file has free inside it: the registration must grow it
				action: context.store.registerDocument(
					makeDocument({ metadata: { note: 'x'.repeat(100_000) } }),
				),
				key: 'STORE_QUOTA_EXCEEDED',
			})
			expect(await context.store.getDocuments()).toEqual([])
		},
	},
}

export const STORE_CONTRACT: StoreContractGroups = {
	lifecycle,
	'document registry': registry,
	reads,
	'bulk writes': bulkWrites,
	'commit and history': needing({ needs: ['history'], cases: history }),
	reopen,
	'sibling order': siblingOrder,
	'changelog snapshots': needing({ needs: ['history'], cases: snapshots }),
	'rejected writes': { ...rejectedWrites, ...nonJsonWrites, ...nonJsonPatchOfAbsentRecord },
	'JSON values only': {
		...nonJsonValues,
		...nonJsonBlobValues,
		...undefinedFieldsDropped,
		...proxiesKept,
		...extraFieldsDropped,
		...nonJsonPatchPlace,
		...nonJsonRefusalOrder,
		...nonJsonBlobRefusalOrder,
	},
	'a document that is not there': absentDocument,
	'a removed document leaves no history': needing({ needs: ['history'], cases: removedDocument }),
	'an edit during an import': duringImport,
	'importing a file': importing,
	'one state for every connection': { ...oneState, ...oneStateAfterDestroy },
	'a store whose storage is full': fullStorage,
	'stores of other names': otherNames,
	blobs: needing({ needs: ['blobs'], cases: blobs }),
	'records are values': needing({ needs: ['history', 'blobs'], cases: values }),
	'list reads in id order': idOrder,
	'a closed store': closedStore,
	'JSON nesting depth': jsonNestingDepth,
}
