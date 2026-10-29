import {
	CONTRACT_BYTE_ORDER_MARK,
	CONTRACT_LONE_SURROGATE_TEXT,
	CONTRACT_REPLACED_TEXT,
	KEPT_TEXTS,
} from './store-contract.constants'
import {
	commit,
	contractFile,
	expectRejectsWith,
	makeDocument,
	makeRecord,
} from './store-contract.fixtures'

import { expect } from 'vitest'

import { XML_DECLARATION } from '@/xml/build/xml-writer.constants'

import type { Store } from '../store.types'
import type {
	KeptTextWrite,
	KeyedCall,
	StoreContractCases,
	StoreContractGroups,
} from './store-contract.types'
import type { BlobRecord } from '@/types'

/**
 * A document (no path: a path refuses some of these characters), a record and a blob: `text` as the whole of
 * each value (a record's, an attribute's, a metadata field's) and at the start of every other text (ids,
 * names and keys stay apart and non-empty).
 */
function keptTextWrite(params: { text: string }): KeptTextWrite {
	const { text } = params
	const documentId = `${text}document`
	const record = makeRecord({
		id: `${text}record`,
		tagName: `${text}Tag`,
		namespace: { prefix: `${text}prefix`, uri: `${text}uri` },
		attributes: [{ name: `${text}name`, value: text }],
		value: text,
		parent: { id: `${text}parent`, tagName: `${text}ParentTag` },
		children: [{ id: `${text}child`, tagName: `${text}ChildTag` }],
	})
	return {
		document: makeDocument({
			id: documentId,
			name: `${text}name`,
			extension: `${text}.xml`,
			configKey: `${text}config`,
			writeId: `${text}import`,
			metadata: { [`${text}key`]: text },
		}),
		record,
		blob: {
			id: `${text}blob`,
			documentId,
			name: `${text}file`,
			mimeType: `${text}type`,
			createdAt: 0,
			attachedTo: [{ documentId, recordRef: record.id, attribute: `${text}name` }],
		},
		writeId: `${text}commit`,
	}
}

/** Every read of what `written` wrote answers it exactly as written. */
async function expectKeptAsWritten(params: {
	store: Store
	written: KeptTextWrite
}): Promise<void> {
	const { store, written } = params
	const { document, record, blob, writeId } = written
	expect(await store.getDocument(document.id)).toStrictEqual(document)
	expect(await store.getDocuments()).toStrictEqual([document])
	expect(await store.get(record.id, document.id)).toStrictEqual(record)
	expect(await store.getMany([record.id], document.id)).toStrictEqual([record])
	expect(await store.getByDocumentId(document.id)).toStrictEqual([record])
	expect(await store.getByTagNameInDocument(record.tagName, document.id)).toStrictEqual([record])
	const [entry] = await store.getChangeLog(document.id)
	expect(entry?.writeId).toBe(writeId)
	expect(entry?.operations.creates).toStrictEqual([record])
	expect((await store.getBlob(blob.id))?.entry).toStrictEqual(blob)
	expect(await store.getBlobsByDocument(document.id)).toStrictEqual([blob])
	expect(await store.getBlobsByRecord(document.id, record.id)).toStrictEqual([blob])
}

const keptTexts: StoreContractCases = Object.fromEntries(
	Object.entries(KEPT_TEXTS).map(([kind, text]) => [
		`${kind} as every value and at the start of every other text a store keeps → read back as written, after a reopen, an undo and a redo`,
		{
			needs: ['history', 'blobs'],
			act: async ({ store, reopen }) => {
				const written = keptTextWrite({ text })
				const { document, record, blob, writeId } = written
				await store.registerDocument(document)
				await commit({ store, documentId: document.id, writeId, creates: [record] })
				await store.addBlob(blob, new Blob(['kept']))
				await expectKeptAsWritten({ store, written })
				const reopened = await reopen()
				await expectKeptAsWritten({ store: reopened, written })
				await reopened.undo(document.id)
				expect(await reopened.get(record.id, document.id)).toBeUndefined()
				await reopened.redo(document.id)
				expect(await reopened.get(record.id, document.id)).toStrictEqual(record)
			},
		},
	]),
)

const keptTextOrder: StoreContractCases = {
	'ids that differ past U+FFFF → listed in UTF-16 order (a surrogate pair before U+FFFD)': {
		act: async ({ store }) => {
			const astral = '\u{1D11E}'
			const replacement = '\u{FFFD}'
			await store.registerDocument(makeDocument({ id: replacement }))
			await store.registerDocument(makeDocument({ id: astral }))
			await store.bulkWrite(astral, {
				creates: [makeRecord({ id: replacement }), makeRecord({ id: astral })],
			})
			expect((await store.getDocuments()).map((held) => held.id)).toEqual([astral, replacement])
			expect((await store.getByDocumentId(astral)).map((held) => held.id)).toEqual([
				astral,
				replacement,
			])
		},
	},
}

/**
 * A kept text through an import and an export, in an attribute value: the XML reader trims a text value and
 * collapses what JavaScript counts as whitespace in it (a byte order mark among them).
 */
const keptTextExport: StoreContractCases = {
	'an attribute value beginning with a byte order mark, imported then exported compact → the file holds it as written':
		{
			needs: ['export'],
			act: async ({ store }) => {
				const bom = CONTRACT_BYTE_ORDER_MARK
				const body = `<A aA="${bom}1"><AA_1 aAA_1="${bom}x">text value</AA_1></A>`
				const { record } = await store.importFile({ file: contractFile({ body }) })
				const { file } = await store.exportFile({
					documentId: record.id,
					options: { indent: false },
				})
				const source = await contractFile({ body }).text()
				expect(await file.text()).toBe(`${XML_DECLARATION}${source}`)
			},
		},
}

const LONE = CONTRACT_LONE_SURROGATE_TEXT
const TWIN = CONTRACT_REPLACED_TEXT

/** The twin's blob: attached to the twin's record of the twin's document. */
const TWIN_BLOB: BlobRecord = {
	id: TWIN,
	documentId: TWIN,
	name: 'file.bin',
	createdAt: 0,
	attachedTo: [{ documentId: TWIN, recordRef: TWIN }],
}

/** A document, a record (also its tag), a commit and a blob, each keyed by the twin of `LONE`. */
async function seedTwin(store: Store): Promise<void> {
	await store.registerDocument(makeDocument({ id: TWIN }))
	await commit({
		store,
		documentId: TWIN,
		writeId: TWIN,
		creates: [makeRecord({ id: TWIN, tagName: TWIN }), makeRecord({ id: 'r2' })],
	})
	await store.addBlob(TWIN_BLOB, new Blob(['twin']))
}

/**
 * What the store holds of the twin: its documents, records, blobs, and the records its history touched (a
 * commit touching nothing still adds an entry).
 */
async function twinState(store: Store): Promise<unknown> {
	const history = await store.getChangeLog(TWIN)
	return {
		documents: await store.getDocuments(),
		records: await store.getByDocumentId(TWIN),
		blobs: await store.getBlobsByDocument(TWIN),
		touched: history.flatMap(({ operations }) => [
			...operations.creates,
			...operations.updates.flatMap(({ before, after }) => [before, after]),
			...operations.deletes,
		]),
	}
}

/** Each store member taking a key, called with `LONE` at one key place (never a value the store keeps). */
const KEYED_CALLS: Record<string, KeyedCall> = {
	getDocument: { call: (store) => store.getDocument(LONE), answers: undefined },
	isDocumentReadable: { call: (store) => store.isDocumentReadable(LONE), answers: false },
	'get, by its id': { call: (store) => store.get(LONE, TWIN), answers: undefined },
	'get, by its document': { call: (store) => store.get(TWIN, LONE), answers: undefined },
	getMany: { call: (store) => store.getMany([LONE], TWIN), answers: [undefined] },
	getByDocumentId: { call: (store) => store.getByDocumentId(LONE), answers: [] },
	count: { call: (store) => store.count(LONE), answers: 0 },
	'getByTagNameInDocument, by its tag': {
		call: (store) => store.getByTagNameInDocument(LONE, TWIN),
		answers: [],
	},
	'getByTagNameInDocument, by its document': {
		call: (store) => store.getByTagNameInDocument(TWIN, LONE),
		answers: [],
	},
	getWriteOutcome: {
		call: (store) => store.getWriteOutcome({ writeId: LONE }),
		answers: 'not-applied',
	},
	getHistoryStatus: {
		call: (store) => store.getHistoryStatus(LONE),
		answers: { canUndo: false, canRedo: false },
	},
	getChangeLog: { call: (store) => store.getChangeLog(LONE), answers: [] },
	undo: { call: (store) => store.undo(LONE), answers: undefined },
	redo: { call: (store) => store.redo(LONE), answers: undefined },
	getBlob: { call: (store) => store.getBlob(LONE), answers: undefined },
	getBlobsByDocument: { call: (store) => store.getBlobsByDocument(LONE), answers: [] },
	'getBlobsByRecord, by its document': {
		call: (store) => store.getBlobsByRecord(LONE, TWIN),
		answers: [],
	},
	'getBlobsByRecord, by its record': {
		call: (store) => store.getBlobsByRecord(TWIN, LONE),
		answers: [],
	},
	exportFile: {
		needs: ['export'],
		call: (store) => store.exportFile({ documentId: LONE }),
		refused: 'DOCUMENT_NOT_REGISTERED',
	},
	updateDocument: {
		call: (store) => store.updateDocument(LONE, { name: 'renamed' }),
		answers: undefined,
	},
	removeDocument: { call: (store) => store.removeDocument(LONE), answers: undefined },
	'bulkWrite, by its document': {
		call: (store) => store.bulkWrite(LONE, { creates: [makeRecord({ id: 'r9' })] }),
		refused: 'DOCUMENT_NOT_REGISTERED',
	},
	"bulkWrite, a patch's record": {
		call: (store) => store.bulkWrite(TWIN, { updates: [{ recordId: LONE, value: 'patched' }] }),
		answers: undefined,
	},
	'bulkWrite, a delete': {
		call: (store) => store.bulkWrite(TWIN, { deletes: [LONE] }),
		answers: undefined,
	},
	'commit, by its document': {
		call: (store) => commit({ store, documentId: LONE, creates: [makeRecord({ id: 'r9' })] }),
		refused: 'DOCUMENT_NOT_REGISTERED',
	},
	"commit, an update's record": {
		call: (store) => commit({ store, documentId: TWIN, updates: [makeRecord({ id: LONE })] }),
		refused: 'STORE_RECORD_NOT_FOUND',
		meta: { documentId: TWIN, recordId: LONE },
	},
	'commit, a delete': {
		call: (store) => commit({ store, documentId: TWIN, deletes: [LONE] }),
		answers: undefined,
	},
	'addBlob, its owner': {
		call: (store) =>
			store.addBlob({ ...TWIN_BLOB, id: 'b9', documentId: LONE, attachedTo: [] }, new Blob(['x'])),
		refused: 'DOCUMENT_NOT_REGISTERED',
	},
	'attachBlob, its blob': {
		call: (store) => store.attachBlob(LONE, { documentId: TWIN, recordRef: 'r2' }),
		refused: 'STORE_BLOB_NOT_FOUND',
	},
	'detachBlob, its blob': {
		call: (store) => store.detachBlob(LONE, { documentId: TWIN, recordRef: TWIN }),
		refused: 'STORE_BLOB_NOT_FOUND',
	},
	"detachBlob, its reference's document": {
		call: (store) => store.detachBlob(TWIN, { documentId: LONE, recordRef: TWIN }),
		answers: undefined,
	},
	"detachBlob, its reference's record": {
		call: (store) => store.detachBlob(TWIN, { documentId: TWIN, recordRef: LONE }),
		answers: undefined,
	},
	removeBlob: { call: (store) => store.removeBlob(LONE), answers: undefined },
	reconcile: { call: (store) => store.reconcile(LONE), answers: undefined },
}

const keysNamingNothing: StoreContractCases = Object.fromEntries(
	Object.entries(KEYED_CALLS).map(([member, keyedCall]) => [
		`${member} with a key holding a lone surrogate, its twin holding U+FFFD held → the answer for a key not held, the twin as it was`,
		{
			needs: ['history', 'blobs', ...(keyedCall.needs ?? [])],
			act: async ({ store }) => {
				await seedTwin(store)
				const before = await twinState(store)
				if ('refused' in keyedCall) {
					await expectRejectsWith({
						action: keyedCall.call(store),
						key: keyedCall.refused,
						meta: keyedCall.meta,
					})
				} else expect(await keyedCall.call(store)).toStrictEqual(keyedCall.answers)
				expect(await twinState(store)).toStrictEqual(before)
			},
		},
	]),
)

/** Text a store keeps: every store reads it back exactly as written. */
export const STORE_TEXT_CONTRACT: StoreContractGroups = {
	'text kept as written': { ...keptTexts, ...keptTextOrder, ...keptTextExport },
	'a key that is not well-formed names nothing': keysNamingNothing,
}
