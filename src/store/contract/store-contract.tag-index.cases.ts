import { CONTRACT_SESSION_FAIL_VALUE, CONTRACT_SESSION_TAG } from './store-contract.constants'
import {
	commit,
	contractFile,
	expectRejectsWith,
	makeDocument,
	makeRecord,
	scribble,
} from './store-contract.fixtures'
import { holdContractImport, untilHeld } from './store-contract.import-session'

import { expect } from 'vitest'

import type { Store } from '../store.types'
import type {
	StoreContractCases,
	StoreContractContext,
	StoreContractGroups,
	ValueRead,
} from './store-contract.types'

const DOCUMENT_ID = 'doc-1'

/** The ids each of `tags` answers in the document, by tag. */
async function idsByTag(params: {
	store: Store
	tags: string[]
}): Promise<Record<string, string[]>> {
	const { store, tags } = params
	const answers = await Promise.all(
		tags.map((tagName) => store.getByTagNameInDocument(tagName, DOCUMENT_ID)),
	)
	return Object.fromEntries(
		tags.map((tagName, index) => [tagName, answers[index]!.map((record) => record.id)]),
	)
}

/** `m` and `c` of A, `x` of B, written out of id order. */
async function seedTags(params: { store: Store }): Promise<void> {
	const { store } = params
	await store.registerDocument(makeDocument())
	await store.bulkWrite(DOCUMENT_ID, {
		creates: [
			makeRecord({ id: 'm', tagName: 'A' }),
			makeRecord({ id: 'x', tagName: 'B' }),
			makeRecord({ id: 'c', tagName: 'A' }),
		],
	})
}

const tagOrder: StoreContractCases = {
	'the tag read, then a bulk write creating out of id order, then one deleting → the tag in id order, the deleted gone':
		{
			act: async ({ store }) => {
				await seedTags({ store })
				const seeded = await idsByTag({ store, tags: ['A'] })
				expect(seeded).toEqual({ A: ['c', 'm'] })
				await store.bulkWrite(DOCUMENT_ID, {
					creates: [makeRecord({ id: 'z', tagName: 'A' }), makeRecord({ id: 'a', tagName: 'A' })],
				})
				await store.bulkWrite(DOCUMENT_ID, { deletes: ['m'] })
				const tags = await idsByTag({ store, tags: ['A', 'B'] })
				expect(tags).toEqual({ A: ['a', 'c', 'z'], B: ['x'] })
			},
		},
	'a commit creating and deleting, its undo, its redo → the tag in id order at each step': {
		needs: ['history'],
		act: async ({ store }) => {
			await seedTags({ store })
			await commit({
				store,
				documentId: DOCUMENT_ID,
				creates: [makeRecord({ id: 'z', tagName: 'A' }), makeRecord({ id: 'a', tagName: 'A' })],
				deletes: ['c'],
			})
			const committed = await idsByTag({ store, tags: ['A'] })
			await store.undo(DOCUMENT_ID)
			const undone = await idsByTag({ store, tags: ['A'] })
			await store.redo(DOCUMENT_ID)
			const redone = await idsByTag({ store, tags: ['A'] })
			expect({ committed, undone, redone }).toEqual({
				committed: { A: ['a', 'm', 'z'] },
				undone: { A: ['c', 'm'] },
				redone: { A: ['a', 'm', 'z'] },
			})
		},
	},
	'a commit moving a record to another tag, its undo, its redo → under one tag at each step': {
		needs: ['history'],
		act: async ({ store }) => {
			await seedTags({ store })
			await commit({
				store,
				documentId: DOCUMENT_ID,
				updates: [makeRecord({ id: 'm', tagName: 'B' })],
			})
			const committed = await idsByTag({ store, tags: ['A', 'B'] })
			await store.undo(DOCUMENT_ID)
			const undone = await idsByTag({ store, tags: ['A', 'B'] })
			await store.redo(DOCUMENT_ID)
			const redone = await idsByTag({ store, tags: ['A', 'B'] })
			expect({ committed, undone, redone }).toEqual({
				committed: { A: ['c'], B: ['m', 'x'] },
				undone: { A: ['c', 'm'], B: ['x'] },
				redone: { A: ['c'], B: ['m', 'x'] },
			})
		},
	},
	'a bulk-write patch moving a record to another tag → under the new tag only': {
		act: async ({ store }) => {
			await seedTags({ store })
			await store.bulkWrite(DOCUMENT_ID, { updates: [{ recordId: 'c', tagName: 'B' }] })
			const tags = await idsByTag({ store, tags: ['A', 'B'] })
			expect(tags).toEqual({ A: ['m'], B: ['c', 'x'] })
		},
	},
	'the tag read, then a bulk write creating a taken id → refused, the tag as it was': {
		act: async ({ store }) => {
			await seedTags({ store })
			const before = await idsByTag({ store, tags: ['A', 'B'] })
			await expectRejectsWith({
				action: store.bulkWrite(DOCUMENT_ID, {
					creates: [makeRecord({ id: 'a', tagName: 'A' }), makeRecord({ id: 'm', tagName: 'B' })],
				}),
				key: 'STORE_DUPLICATE_ID',
			})
			const after = await idsByTag({ store, tags: ['A', 'B'] })
			expect(after).toEqual(before)
		},
	},
	'the tag read, then a commit creating and updating a record the document does not hold → refused, the tag as it was':
		{
			needs: ['history'],
			act: async ({ store }) => {
				await seedTags({ store })
				const before = await idsByTag({ store, tags: ['A'] })
				await expectRejectsWith({
					action: commit({
						store,
						documentId: DOCUMENT_ID,
						creates: [makeRecord({ id: 'a', tagName: 'A' })],
						updates: [makeRecord({ id: 'absent', tagName: 'A' })],
					}),
					key: 'STORE_RECORD_NOT_FOUND',
				})
				const after = await idsByTag({ store, tags: ['A'] })
				expect(after).toEqual(before)
			},
		},
	'a removed document registered again → its tags answer nothing': {
		act: async ({ store }) => {
			await seedTags({ store })
			await store.removeDocument(DOCUMENT_ID)
			await store.registerDocument(makeDocument())
			const tags = await idsByTag({ store, tags: ['A', 'B'] })
			expect(tags).toEqual({ A: [], B: [] })
		},
	},
}

/** The ids of the session's tag in the document, by a tag read and by a read of the whole document (id order). */
async function importedTagIds(params: {
	store: Store
	documentId: string
}): Promise<{ byTag: string[]; inIdOrder: string[] }> {
	const { store, documentId } = params
	const tagged = await store.getByTagNameInDocument(CONTRACT_SESSION_TAG, documentId)
	const all = await store.getByDocumentId(documentId)
	return {
		byTag: tagged.map((record) => record.id),
		inIdOrder: all
			.filter((record) => record.tagName === CONTRACT_SESSION_TAG)
			.map((record) => record.id),
	}
}

const afterImports: StoreContractCases = {
	"an import, then an import that fails → the tag in id order; the failed document's tag answers nothing":
		{
			needs: ['import'],
			act: async ({ store }) => {
				const imported = await store.importFile({
					file: contractFile({ body: '<B aB="B2"/><B aB="B0"/><B aB="B1"/>' }),
				})
				const importedTag = await importedTagIds({ store, documentId: imported.record.id })
				const hold = holdContractImport()
				const importing = store.importFile({
					file: contractFile({
						body: `<B aB="B0" bB="${hold.value}"/><B aB="B1" bB="${CONTRACT_SESSION_FAIL_VALUE}"/>`,
					}),
				})
				try {
					await untilHeld({ hold, importing })
					const documents = await store.getDocuments()
					const failing = documents.find((document) => document.id !== imported.record.id)
					hold.release()
					await expectRejectsWith({ action: importing, key: 'IMPORT_FAILED' })
					const failedTag = await store.getByTagNameInDocument(
						CONTRACT_SESSION_TAG,
						failing?.id ?? 'not-registered',
					)
					const importedTagAfter = await importedTagIds({ store, documentId: imported.record.id })
					expect({
						importedCount: importedTag.byTag.length,
						importedTag,
						failingSeen: failing !== undefined,
						failedTag,
						importedTagAfter,
					}).toEqual({
						importedCount: 3,
						importedTag: { byTag: importedTag.inIdOrder, inIdOrder: importedTag.inIdOrder },
						failingSeen: true,
						failedTag: [],
						importedTagAfter: importedTag,
					})
				} finally {
					hold.release()
					await importing.catch(() => undefined)
				}
			},
		},
}

/** A record of A with a qualified attribute, a parent and a child, beside its child of B. */
async function seedQualified(params: { store: Store }): Promise<void> {
	const { store } = params
	await store.registerDocument(makeDocument())
	await store.bulkWrite(DOCUMENT_ID, {
		creates: [
			makeRecord({
				id: 'r1',
				tagName: 'A',
				attributes: [
					{ name: 'aA', value: '1', namespace: { prefix: 'q', uri: 'urn:q' } },
					{ name: 'bA', value: '2' },
				],
				parent: { id: 'r0', tagName: 'Root' },
				children: [{ id: 'r2', tagName: 'B' }],
			}),
			makeRecord({ id: 'r2', tagName: 'B', parent: { id: 'r1', tagName: 'A' } }),
		],
	})
}

const QUALIFIED_READS: Record<string, ValueRead> = {
	get: (store) => store.get('r1', DOCUMENT_ID),
	getMany: (store) => store.getMany(['r2', 'r1'], DOCUMENT_ID),
	getByTagNameInDocument: (store) => store.getByTagNameInDocument('A', DOCUMENT_ID),
	getByDocumentId: (store) => store.getByDocumentId(DOCUMENT_ID),
}

const qualifiedValues: StoreContractCases = Object.fromEntries(
	Object.entries(QUALIFIED_READS).map(([name, read]) => [
		`${name}: the caller changes a qualified attribute's namespace it read → the next ${name} answers as before`,
		{
			act: async ({ store }: StoreContractContext) => {
				await seedQualified({ store })
				const first = await read(store)
				const asRead = structuredClone(first)
				scribble(first)
				const readBack = await read(store)
				expect(readBack).toEqual(asRead)
			},
		},
	]),
)

/** The tag index of a store: every write path keeps a tag's answer, in id order; an answer is the caller's own. */
export const STORE_TAG_INDEX_CONTRACT: StoreContractGroups = {
	'tag reads in id order after every write': tagOrder,
	'tag reads after imports': afterImports,
	'records are values, deep': qualifiedValues,
}
