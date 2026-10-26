import {
	CONTRACT_EXPORT_FORMATTED,
	CONTRACT_EXPORT_SOURCE,
	WRITE_AFTER_RECORDS,
} from './store-contract.constants'
import {
	commit,
	contractFile,
	expectRejectsWith,
	makeDocument,
	makeRecord,
} from './store-contract.fixtures'

import { expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { XML_DECLARATION } from '@/xml/build/xml-writer.constants'

import type { ExportProgress, Store } from '../store.types'
import type {
	EditedRecords,
	StoreContractCases,
	StoreContractGroups,
	WriteDuringExport,
} from './store-contract.types'
import type { AnyRawRecord } from '@/types'

/** The source file imported, answered with its document id. */
async function importSource(params: { store: Store; name?: string }): Promise<string> {
	const { store, name } = params
	const result = await store.importFile({
		file: contractFile({ body: CONTRACT_EXPORT_SOURCE, name }),
	})
	return result.record.id
}

async function exportedText(params: {
	store: Store
	documentId: string
	indent?: boolean
}): Promise<string> {
	const { store, documentId, indent } = params
	const { file } = await store.exportFile({ documentId, options: { indent } })
	return file.text()
}

/** The source as the export writes it compact: the declaration, then the file as imported. */
async function compactSource(): Promise<string> {
	const source = await contractFile({ body: CONTRACT_EXPORT_SOURCE }).text()
	return `${XML_DECLARATION}${source}`
}

/** The source's records `A` (written first) and `C` (read last), each with its one attribute edited. */
async function editedAAndC(params: { store: Store; documentId: string }): Promise<EditedRecords> {
	const { store, documentId } = params
	const [a] = await store.getByTagNameInDocument('A', documentId)
	const [c] = await store.getByTagNameInDocument('C', documentId)
	return {
		a: { ...a!, attributes: [{ name: 'aA', value: 'edited' }] },
		c: { ...c!, attributes: [{ name: 'aC', value: 'edited' }] },
	}
}

/** Remove the document `again` and register it anew under its id, written in one bulk write. */
async function replaceDocument(params: { store: Store; records: AnyRawRecord[] }): Promise<void> {
	const { store, records } = params
	await store.removeDocument('again')
	await store.registerDocument(makeDocument({ id: 'again', configKey: 'default' }))
	await store.bulkWrite('again', { creates: records })
}

function commitEdits(params: {
	store: Store
	documentId: string
	edited: EditedRecords
}): Promise<void> {
	const { store, documentId, edited } = params
	return commit({ store, documentId, updates: [edited.a, edited.c] })
}

/**
 * A write on the document while it is exported, once `A`'s subtree is written and before `C` is read (one record
 * per batch: told after the root, `A`, `AA_1`): the file is the one before the write or the one after it, never a
 * mix - a store whose write leaves its version unchanged answers `A` before and `C` after.
 */
const WRITES_DURING_AN_EXPORT: Record<string, WriteDuringExport> = {
	'a bulk write': {
		write: ({ writer, documentId, edited }) =>
			writer.bulkWrite(documentId, {
				updates: [
					{ recordId: edited.a.id, attributes: edited.a.attributes },
					{ recordId: edited.c.id, attributes: edited.c.attributes },
				],
			}),
	},
	'a commit': {
		write: ({ writer, documentId, edited }) => commitEdits({ store: writer, documentId, edited }),
	},
	'an undo': {
		arrange: ({ store, documentId, edited }) => commitEdits({ store, documentId, edited }),
		write: ({ writer, documentId }) => writer.undo(documentId),
	},
	'a redo': {
		arrange: async ({ store, documentId, edited }) => {
			await commitEdits({ store, documentId, edited })
			await store.undo(documentId)
		},
		write: ({ writer, documentId }) => writer.redo(documentId),
	},
	'a commit through another connection': {
		needs: 'second-connection',
		write: ({ writer, documentId, edited }) => commitEdits({ store: writer, documentId, edited }),
	},
}

const writesDuringAnExport: StoreContractCases = Object.fromEntries(
	Object.entries(WRITES_DURING_AN_EXPORT).map(([name, writeCase]) => [
		`${name} while it exports, A written and C not yet read -> the file before it or after it, never a mix`,
		{
			needs: writeCase.needs,
			act: async (context) => {
				const { store } = context
				const documentId = await importSource({ store })
				const edited = await editedAAndC({ store, documentId })
				// a second connection is opened before the export, so the write only has to land
				const writer = writeCase.needs === 'second-connection' ? await context.connect() : store
				await writeCase.arrange?.({ store, writer, documentId, edited })
				const before = await exportedText({ store, documentId, indent: false })
				let written: Promise<void> | undefined
				const { file } = await store.exportFile({
					documentId,
					options: { indent: false, batchSize: 1 },
					onProgress: ({ recordsWritten }) => {
						if (recordsWritten === WRITE_AFTER_RECORDS)
							written ??= writeCase.write({ store, writer, documentId, edited })
					},
				})
				await written
				const after = await exportedText({ store, documentId, indent: false })
				expect(after).not.toBe(before)
				expect([before, after]).toContain(await file.text())
			},
		},
	]),
)

const exporting: StoreContractCases = {
	'import then export, compact -> the file as imported': {
		act: async ({ store }) => {
			const documentId = await importSource({ store })
			expect(await exportedText({ store, documentId, indent: false })).toBe(await compactSource())
		},
	},
	'export, formatted -> the bytes of the download layout': {
		act: async ({ store }) => {
			const documentId = await importSource({ store })
			expect(await exportedText({ store, documentId })).toBe(CONTRACT_EXPORT_FORMATTED)
		},
	},
	'an export answers an XML file named after its document': {
		act: async ({ store }) => {
			const documentId = await importSource({ store, name: 'plant.xml' })
			const { file, filename } = await store.exportFile({ documentId })
			expect(filename).toBe('plant.xml')
			expect(file.type).toBe('application/xml')
		},
	},
	'database ids -> every element carries the id of its record': {
		act: async ({ store }) => {
			const documentId = await importSource({ store })
			const { file } = await store.exportFile({
				documentId,
				options: { indent: false, withDatabaseIds: true },
			})
			const written = [...(await file.text()).matchAll(/_temp-idb-id="([^"]+)"/g)].map(
				(match) => match[1],
			)
			const records = await store.getByDocumentId(documentId)
			expect(written.sort()).toEqual(records.map((record) => record.id).sort())
		},
	},
	'progress per written batch, out of the document record count': {
		act: async ({ store }) => {
			const documentId = await importSource({ store })
			const told: ExportProgress[] = []
			await store.exportFile({
				documentId,
				options: { batchSize: 1 },
				onProgress: (progress) => told.push(progress),
			})
			const totalRecords = await store.count(documentId)
			expect(told.map((progress) => progress.recordsWritten)).toEqual(
				Array.from({ length: totalRecords }, (_, index) => index + 1),
			)
			expect(told.every((progress) => progress.totalRecords === totalRecords)).toBe(true)
		},
	},
	'the document removed and registered again under its id while it exports -> DOCUMENT_NOT_REGISTERED, or the file before or after it, never a mix':
		{
			act: async ({ store }) => {
				const sourceId = await importSource({ store })
				const records = await store.getByDocumentId(sourceId)
				// a document written in one bulk write, then the same again under its id with A and C edited: as many
				// writes each time, so only a version kept across the removal tells the two apart
				await store.registerDocument(makeDocument({ id: 'again', configKey: 'default' }))
				await store.bulkWrite('again', { creates: records })
				const before = await exportedText({ store, documentId: 'again', indent: false })
				const edited = await editedAAndC({ store, documentId: 'again' })
				const editedRecords = records.map((record) =>
					record.id === edited.a.id ? edited.a : record.id === edited.c.id ? edited.c : record,
				)
				let replaced: Promise<void> | undefined
				const outcome = await store
					.exportFile({
						documentId: 'again',
						options: { indent: false, batchSize: 1 },
						onProgress: ({ recordsWritten }) => {
							if (recordsWritten === WRITE_AFTER_RECORDS)
								replaced ??= replaceDocument({ store, records: editedRecords })
						},
					})
					.then(
						(result) => result.file.text(),
						(error: unknown) => toDialecteError(error)?.key,
					)
				await replaced
				const after = await exportedText({ store, documentId: 'again', indent: false })
				expect(after).not.toBe(before)
				expect([before, after, 'DOCUMENT_NOT_REGISTERED']).toContain(outcome)
			},
		},
	'a write on another document while it exports -> the file as it was': {
		act: async ({ store }) => {
			const documentId = await importSource({ store })
			await store.registerDocument(makeDocument({ id: 'other' }))
			const before = await exportedText({ store, documentId, indent: false })
			const { file } = await store.exportFile({
				documentId,
				options: { indent: false, batchSize: 1 },
				onProgress: () => {
					void store.bulkWrite('other', {
						creates: [makeRecord({ id: `o-${crypto.randomUUID()}` })],
					})
				},
			})
			expect(await file.text()).toBe(before)
		},
	},
	'the document removed while it exports -> DOCUMENT_NOT_REGISTERED or the file before it, never a broken one':
		{
			act: async ({ store }) => {
				const documentId = await importSource({ store })
				const before = await exportedText({ store, documentId, indent: false })
				let removed: Promise<void> | undefined
				const outcome = await store
					.exportFile({
						documentId,
						options: { indent: false, batchSize: 1 },
						onProgress: () => {
							removed ??= store.removeDocument(documentId)
						},
					})
					.then(
						(result) => result.file.text(),
						(error: unknown) => toDialecteError(error)?.key,
					)
				await removed
				expect([before, 'DOCUMENT_NOT_REGISTERED']).toContain(outcome)
			},
		},
	'a close() while it exports -> the export completes': {
		act: async ({ store }) => {
			const documentId = await importSource({ store })
			const before = await exportedText({ store, documentId, indent: false })
			const { file } = await store.exportFile({
				documentId,
				options: { indent: false, batchSize: 1 },
				onProgress: () => store.close(),
			})
			expect(await file.text()).toBe(before)
		},
	},
}

const refusedExports: StoreContractCases = {
	'a document not registered -> DOCUMENT_NOT_REGISTERED': {
		act: async ({ store }) => {
			await expectRejectsWith({
				action: store.exportFile({ documentId: 'nowhere' }),
				key: 'DOCUMENT_NOT_REGISTERED',
			})
		},
	},
	'a document still importing -> DOCUMENT_NOT_REGISTERED': {
		act: async ({ store }) => {
			await store.registerDocument(
				makeDocument({ id: 'a', status: 'importing', configKey: 'default' }),
			)
			await store.bulkWrite('a', { creates: [makeRecord({ id: 'root', tagName: 'Root' })] })
			await expectRejectsWith({
				action: store.exportFile({ documentId: 'a' }),
				key: 'DOCUMENT_NOT_REGISTERED',
			})
		},
	},
	'aborted before it starts -> EXPORT_ABORTED': {
		act: async ({ store }) => {
			const documentId = await importSource({ store })
			await expectRejectsWith({
				action: store.exportFile({ documentId, signal: AbortSignal.abort() }),
				key: 'EXPORT_ABORTED',
			})
		},
	},
	'aborted while it runs -> EXPORT_ABORTED': {
		act: async ({ store }) => {
			const documentId = await importSource({ store })
			const controller = new AbortController()
			await expectRejectsWith({
				action: store.exportFile({
					documentId,
					options: { batchSize: 1 },
					onProgress: () => controller.abort(),
					signal: controller.signal,
				}),
				key: 'EXPORT_ABORTED',
			})
		},
	},
}

/** What every store answers when it exports a document; merged into the store contract. */
export const STORE_EXPORT_CONTRACT: StoreContractGroups = {
	'exporting a document': exporting,
	'a write during an export': writesDuringAnExport,
	'refused exports': refusedExports,
}
