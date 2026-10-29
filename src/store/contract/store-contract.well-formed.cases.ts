import { CONTRACT_LONE_SURROGATE_TEXT } from './store-contract.constants'
import {
	childRef,
	commit,
	contractFile,
	expectRejectsWith,
	makeBlobEntry,
	makeDocument,
	makeRecord,
	sessionRecords,
	SMALL_BATCHES,
} from './store-contract.fixtures'

import { expect } from 'vitest'

import type { Store } from '../store.types'
import type {
	ImportWithLoneSurrogate,
	StoreContractCases,
	StoreContractGroups,
	TextPlace,
} from './store-contract.types'
import type { DocumentUpdates } from '@/project/types'
import type { AnyRawRecord, RecordPatch } from '@/types'

const LONE = CONTRACT_LONE_SURROGATE_TEXT

/** A record created with `overrides`, the rest as `makeRecord` has it. */
function recordWith(overrides: Partial<AnyRawRecord>): AnyRawRecord {
	return makeRecord({ id: 'r9', ...overrides })
}

/** The record fields that are text, each holding a lone surrogate in turn. */
const RECORD_TEXTS: Record<string, Partial<AnyRawRecord>> = {
	id: { id: LONE },
	tagName: { tagName: LONE },
	'namespace prefix': { namespace: { prefix: LONE, uri: '' } },
	'namespace uri': { namespace: { prefix: '', uri: LONE } },
	"an attribute's name": { attributes: [{ name: LONE, value: '1' }] },
	"its parent's id": { parent: childRef(LONE) },
	"its parent's tag": { parent: { id: 'r0', tagName: LONE } },
	"a child's id": { children: [childRef(LONE)] },
	"a child's tag": { children: [{ id: 'r0', tagName: LONE }] },
}

/** The record fields a patch may carry that are text, each holding a lone surrogate in turn. */
const PATCH_TEXTS: Record<string, Partial<RecordPatch>> = {
	tagName: { tagName: LONE },
	'namespace uri': { namespace: { prefix: '', uri: LONE } },
	"an attribute's name": { attributes: [{ name: LONE, value: '1' }] },
	"its parent's id": { parent: childRef(LONE) },
	"a child's tag": { children: [{ id: 'r0', tagName: LONE }] },
}

/**
 * Where a write hands a store text the "JSON values only" table does not reach: every one is refused when
 * it holds a lone surrogate.
 */
const TEXT_PLACES: Record<string, TextPlace> = {
	"a document's id, registered": {
		write: (store) => store.registerDocument(makeDocument({ id: LONE })),
	},
	"a document's name, registered": {
		write: (store) => store.registerDocument(makeDocument({ id: 'doc-2', name: LONE })),
	},
	"a document's extension, registered": {
		write: (store) => store.registerDocument(makeDocument({ id: 'doc-2', extension: LONE })),
	},
	"a document's config key, registered": {
		write: (store) => store.registerDocument(makeDocument({ id: 'doc-2', configKey: LONE })),
	},
	"a document's write id, registered": {
		write: (store) => store.registerDocument(makeDocument({ id: 'doc-2', writeId: LONE })),
	},
	"a document's path, registered (its value is checked before the path rules)": {
		write: (store) =>
			store.registerDocument(makeDocument({ id: 'doc-2', path: `${LONE}/test-doc.xml` })),
	},
	"a document's metadata key, registered": {
		write: (store) =>
			store.registerDocument(makeDocument({ id: 'doc-2', metadata: { [LONE]: 'held' } })),
	},
	"a document's name, updated": {
		write: (store) => store.updateDocument('doc-1', { name: LONE }),
	},
	"a document's path, updated (its value is checked before the path rules)": {
		write: (store) => store.updateDocument('doc-1', { path: `${LONE}/test-doc.xml` }),
	},
	"a document's metadata key, updated": {
		write: (store) => store.updateDocument('doc-1', { metadata: { [LONE]: 'held' } }),
	},
	'a key an update ignores (extension), updated': {
		write: (store) => store.updateDocument('doc-1', { extension: LONE } as DocumentUpdates),
	},
	...Object.fromEntries(
		Object.entries(RECORD_TEXTS).flatMap(([field, overrides]) => [
			[
				`a record's ${field}, created by a bulk write`,
				{
					write: (store: Store) => store.bulkWrite('doc-1', { creates: [recordWith(overrides)] }),
				},
			],
			[
				`a record's ${field}, created by a commit`,
				{
					needs: ['history'],
					write: (store: Store) =>
						commit({ store, documentId: 'doc-1', creates: [recordWith(overrides)] }),
				},
			],
		]),
	),
	...Object.fromEntries(
		Object.entries(PATCH_TEXTS).flatMap(([field, overrides]) => [
			[
				`a record's ${field}, patched by a bulk write`,
				{
					write: (store: Store) =>
						store.bulkWrite('doc-1', { updates: [{ recordId: 'r1', ...overrides }] }),
				},
			],
			[
				`a record's ${field}, updated by a commit`,
				{
					needs: ['history'],
					write: (store: Store) =>
						commit({
							store,
							documentId: 'doc-1',
							updates: [makeRecord({ id: 'r1', ...overrides })],
						}),
				},
			],
		]),
	),
	"a blob entry's id, added": {
		needs: ['blobs'],
		write: (store) => store.addBlob(makeBlobEntry({ id: LONE }), new Blob(['b'])),
	},
	"a blob entry's name, added": {
		needs: ['blobs'],
		write: (store) => store.addBlob(makeBlobEntry({ id: 'b9', name: LONE }), new Blob(['b'])),
	},
	"a blob entry's MIME type, added": {
		needs: ['blobs'],
		write: (store) => store.addBlob(makeBlobEntry({ id: 'b9', mimeType: LONE }), new Blob(['b'])),
	},
	"a reference's document, attached to a blob": {
		needs: ['blobs'],
		write: (store) => store.attachBlob('b1', { documentId: LONE, recordRef: 'r1' }),
	},
	"a reference's attribute, attached to a blob": {
		needs: ['blobs'],
		write: (store) =>
			store.attachBlob('b1', { documentId: 'doc-1', recordRef: 'r1', attribute: LONE }),
	},
}

/** What a refused write must leave: the documents, records, blobs and history as they were. */
async function heldState(store: Store): Promise<unknown> {
	return {
		documents: await store.getDocuments(),
		records: await store.getByDocumentId('doc-1'),
		blobs: await store.getBlobsByDocument('doc-1'),
		history: await store.getChangeLog('doc-1'),
	}
}

const textPlacesRefused: StoreContractCases = Object.fromEntries(
	Object.entries(TEXT_PLACES).map(([place, { needs = [], write }]) => [
		`a lone surrogate in ${place} → STORE_VALUE_NOT_JSON, nothing written`,
		{
			needs: ['blobs', 'history', ...needs],
			act: async ({ store }) => {
				await store.registerDocument(makeDocument())
				await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
				await store.addBlob(makeBlobEntry({ id: 'b1' }), new Blob(['b1']))
				const before = await heldState(store)
				await expectRejectsWith({
					action: write(store),
					key: 'STORE_VALUE_NOT_JSON',
					detail: /not well-formed UTF-16 \(a lone surrogate\)/,
				})
				expect(await heldState(store)).toStrictEqual(before)
			},
		},
	]),
)

const writeIdOrder: StoreContractCases = {
	"a commit's write id holding a lone surrogate → STORE_VALUE_NOT_JSON naming the field writeId": {
		needs: ['history'],
		act: async ({ store }) => {
			await store.registerDocument(makeDocument())
			await expectRejectsWith({
				action: commit({ store, documentId: 'doc-1', writeId: LONE, creates: [recordWith({})] }),
				key: 'STORE_VALUE_NOT_JSON',
				detail: /\(field "writeId"\)$/,
			})
			expect(await store.getChangeLog('doc-1')).toEqual([])
		},
	},
	'a commit to a document not registered, its write id holding a lone surrogate → DOCUMENT_NOT_REGISTERED: the document is checked first':
		{
			needs: ['history'],
			act: async ({ store }) => {
				await expectRejectsWith({
					action: commit({ store, documentId: 'nope', writeId: LONE, creates: [recordWith({})] }),
					key: 'DOCUMENT_NOT_REGISTERED',
				})
			},
		},
	'a commit to a document still importing, its write id holding a lone surrogate → DOCUMENT_NOT_REGISTERED: the document is checked first':
		{
			needs: ['history'],
			act: async ({ store }) => {
				await store.registerDocument(makeDocument({ status: 'importing' }))
				await expectRejectsWith({
					action: commit({ store, documentId: 'doc-1', writeId: LONE, creates: [recordWith({})] }),
					key: 'DOCUMENT_NOT_REGISTERED',
				})
			},
		},
	'a commit whose write id holds a lone surrogate and which updates a record not held → STORE_VALUE_NOT_JSON: the write id is checked first':
		{
			needs: ['history'],
			act: async ({ store }) => {
				await store.registerDocument(makeDocument())
				await expectRejectsWith({
					action: commit({
						store,
						documentId: 'doc-1',
						writeId: LONE,
						updates: [makeRecord({ id: 'absent' })],
					}),
					key: 'STORE_VALUE_NOT_JSON',
					detail: /\(field "writeId"\)$/,
				})
			},
		},
}

/** Imports handing a lone surrogate - by their write id, their metadata or their file - and the write id they ran under. */
const IMPORTS_WITH_LONE_SURROGATES: Record<string, ImportWithLoneSurrogate> = {
	'its write id': { writeId: LONE },
	'a key of its metadata': { writeId: 'w-metadata-key', options: { metadata: { [LONE]: 'held' } } },
	'a value of its metadata': {
		writeId: 'w-metadata-value',
		options: { metadata: { origin: LONE } },
	},
	'its file, after a batch stored (a character reference to a surrogate in an attribute and in a text)':
		{
			writeId: 'w-file',
			options: { chunkOptions: SMALL_BATCHES },
			body: `${sessionRecords(2)}<B aB="&#xD800;">x&#xDC00;y</B>`,
		},
}

const importsRefused: StoreContractCases = Object.fromEntries(
	Object.entries(IMPORTS_WITH_LONE_SURROGATES).map(([place, { writeId, options, body }]) => [
		`an import with a lone surrogate in ${place} → STORE_VALUE_NOT_JSON, nothing left of it, not applied`,
		{
			needs: ['import'],
			act: async ({ store }) => {
				await store.registerDocument(makeDocument())
				await expectRejectsWith({
					action: store.importFile({
						file: contractFile({ body: body ?? sessionRecords(1) }),
						options,
						writeId,
					}),
					key: 'STORE_VALUE_NOT_JSON',
					detail: /not well-formed UTF-16 \(a lone surrogate\)/,
				})
				expect(await store.getDocuments()).toStrictEqual([makeDocument()])
				expect(await store.getWriteOutcome({ writeId })).toBe('not-applied')
			},
		},
	]),
)

/** Text that is not well-formed: no store keeps it, wherever a write hands it. */
export const STORE_WELL_FORMED_CONTRACT: StoreContractGroups = {
	'text that is not well-formed is refused': {
		...textPlacesRefused,
		...writeIdOrder,
		...importsRefused,
	},
}
