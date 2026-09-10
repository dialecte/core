import { SqliteEngine } from './sqlite-engine'

import { beforeEach, describe, expect, it } from 'vitest'

import type { RecordSchema } from '../store.types'
import type { DocumentRecord } from '@/project/types'
import type { AnyRawRecord, BlobAttachment, BlobRecord } from '@/types'

const SCHEMA: RecordSchema = {
	primaryKey: 'id',
	indexes: ['tagName', 'parent.id', 'parent.tagName'],
	compoundIndexes: [['id', 'tagName']],
	arrayIndexes: ['children.id', 'children.tagName'],
}

const NS = { prefix: '', uri: 'http://www.iec.ch/61850/2003/SCL' }

function doc(id: string): DocumentRecord {
	return { id, name: id, extension: '.scd', configKey: 'default', createdAt: 1 }
}

function rec(id: string, tagName: string, parent?: { id: string; tagName: string }): AnyRawRecord {
	return {
		id,
		tagName,
		namespace: NS,
		value: '',
		parent: parent ?? null,
		attributes: [{ name: 'name', value: `${tagName}_${id}` }],
		children: [],
	} as AnyRawRecord
}

async function freshEngine(): Promise<SqliteEngine> {
	const engine = new SqliteEngine({ recordSchema: SCHEMA })
	await engine.init({ kind: 'memory' })
	return engine
}

describe('SqliteEngine (memory)', () => {
	let engine: SqliteEngine

	beforeEach(async () => {
		engine = await freshEngine()
	})

	it('registers a document and reads it back', async () => {
		await engine.registerDocument(doc('d1'))
		expect(await engine.getDocument('d1')).toMatchObject({ id: 'd1', configKey: 'default' })
		expect(await engine.getDocuments()).toHaveLength(1)
		expect(await engine.isDocumentReadable('d1')).toBe(true)
		expect(await engine.isDocumentReadable('nope')).toBe(false)
	})

	it('bulkWrite creates round-trip through JSON columns (namespace/parent/attributes preserved)', async () => {
		await engine.registerDocument(doc('d1'))
		await engine.bulkWrite('d1', {
			creates: [rec('a', 'IED'), rec('b', 'LN', { id: 'a', tagName: 'IED' })],
		})

		const all = await engine.getByDocumentId('d1')
		expect(all).toHaveLength(2)
		const b = (await engine.get('b', 'd1'))!
		expect(b.parent).toEqual({ id: 'a', tagName: 'IED' })
		expect(b.namespace).toEqual(NS)
		expect(b.attributes).toEqual([{ name: 'name', value: 'LN_b' }])
	})

	it('getByTagNameInDocument filters by tagName', async () => {
		await engine.registerDocument(doc('d1'))
		await engine.bulkWrite('d1', { creates: [rec('a', 'IED'), rec('b', 'LN'), rec('c', 'IED')] })
		const ieds = await engine.getByTagNameInDocument('IED', 'd1')
		expect(ieds.map((r) => r.id).sort()).toEqual(['a', 'c'])
	})

	it('bulkWrite updates merge attributes, deletes remove', async () => {
		await engine.registerDocument(doc('d1'))
		await engine.bulkWrite('d1', { creates: [rec('a', 'IED')] })
		await engine.bulkWrite('d1', {
			updates: [{ recordId: 'a', attributes: [{ name: 'desc', value: 'x' }] }],
		})
		const a = (await engine.get('a', 'd1'))!
		expect(a.attributes).toEqual([
			{ name: 'name', value: 'IED_a' },
			{ name: 'desc', value: 'x' },
		])

		await engine.bulkWrite('d1', { deletes: ['a'] })
		expect(await engine.get('a', 'd1')).toBeUndefined()
	})

	it('beginImport/finalizeImport wraps writes in one transaction; concurrent imports serialize', async () => {
		await engine.registerDocument(doc('d1'))
		await engine.registerDocument(doc('d2'))

		// Fire two imports "concurrently" (as project.import does via Promise.all).
		const imp = async (docId: string, tag: string) => {
			await engine.beginImport()
			await engine.bulkWrite(docId, { creates: [rec(`${docId}-x`, tag)] })
			await engine.finalizeImport()
		}
		await Promise.all([imp('d1', 'IED'), imp('d2', 'LN')])

		expect(await engine.getByDocumentId('d1')).toHaveLength(1)
		expect(await engine.getByDocumentId('d2')).toHaveLength(1)
	})

	it('removeDocument drops the record table and registry row', async () => {
		await engine.registerDocument(doc('d1'))
		await engine.bulkWrite('d1', { creates: [rec('a', 'IED')] })
		await engine.removeDocument('d1')
		expect(await engine.getDocument('d1')).toBeUndefined()
		expect(await engine.isDocumentReadable('d1')).toBe(false)
	})

	it('commit writes a changelog entry; undo/redo restore state', async () => {
		await engine.registerDocument(doc('d1'))
		await engine.bulkWrite('d1', { creates: [rec('a', 'IED')] })

		const original = (await engine.get('a', 'd1'))!
		const edited: AnyRawRecord = {
			...original,
			attributes: [{ name: 'name', value: 'CHANGED' }],
		}
		const progress: Array<[number, number]> = []
		await engine.commit({
			documentId: 'd1',
			creates: [],
			updates: [edited],
			deletes: [],
			onProgress: (c, t) => progress.push([c, t]),
		})

		expect((await engine.get('a', 'd1'))!.attributes).toEqual([{ name: 'name', value: 'CHANGED' }])
		expect(progress.at(-1)).toEqual([1, 1])
		expect(await engine.getChangeLog('d1')).toHaveLength(1)
		expect(await engine.getHistoryStatus('d1')).toEqual({ canUndo: true, canRedo: false })

		await engine.undo('d1')
		expect((await engine.get('a', 'd1'))!.attributes).toEqual([{ name: 'name', value: 'IED_a' }])
		expect(await engine.getHistoryStatus('d1')).toEqual({ canUndo: false, canRedo: true })

		await engine.redo('d1')
		expect((await engine.get('a', 'd1'))!.attributes).toEqual([{ name: 'name', value: 'CHANGED' }])
	})

	it('blobs: add/get round-trip, attach/detach, standalone, remove', async () => {
		await engine.registerDocument(doc('d1'))
		const entry = { id: 'blob1', documentId: 'd1', attachedTo: [] } as unknown as BlobRecord
		await engine.addBlob(
			entry,
			new Blob([new Uint8Array([1, 2, 3])], { type: 'application/x-icd' }),
		)

		const got = (await engine.getBlob('blob1'))!
		expect(got.entry.id).toBe('blob1')
		expect(new Uint8Array(await got.data.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
		expect(got.data.type).toBe('application/x-icd')

		expect(await engine.getStandaloneBlobs()).toHaveLength(1)
		await engine.attachBlob('blob1', { documentId: 'd1', recordRef: 'a' } as BlobAttachment)
		expect(await engine.getBlobsByDocument('d1')).toHaveLength(1)
		expect(await engine.getBlobsByRecord('d1', 'a')).toHaveLength(1)
		expect(await engine.getStandaloneBlobs()).toHaveLength(0)

		await engine.detachBlob('blob1', { documentId: 'd1', recordRef: 'a' })
		expect(await engine.getStandaloneBlobs()).toHaveLength(1)

		await engine.removeBlob('blob1')
		expect(await engine.getBlob('blob1')).toBeUndefined()
	})
})

describe('SqliteEngine — deferred secondary indexes (bulk-load optimization)', () => {
	let engine: SqliteEngine

	beforeEach(async () => {
		engine = await freshEngine()
	})

	it('registerDocument creates the table WITHOUT secondary indexes', async () => {
		await engine.registerDocument(doc('d1'))
		expect(await engine.listRecordIndexes('d1')).toEqual([])
	})

	it('secondary indexes stay absent during import, then are built at finalizeImport', async () => {
		await engine.registerDocument(doc('d1'))
		await engine.beginImport('d1')
		await engine.bulkWrite('d1', {
			creates: [rec('a', 'IED'), rec('b', 'LN', { id: 'a', tagName: 'IED' })],
		})
		// Deferred: inserting into an unindexed table keeps the load sequential.
		expect(await engine.listRecordIndexes('d1')).toEqual([])

		await engine.finalizeImport('d1')
		expect(await engine.listRecordIndexes('d1')).toHaveLength(4)
		// Reads remain correct once the indexes are built.
		expect((await engine.getByTagNameInDocument('IED', 'd1')).map((r) => r.id)).toEqual(['a'])
	})

	it('commit ensures secondary indexes exist for a non-imported document', async () => {
		await engine.registerDocument(doc('d1'))
		await engine.bulkWrite('d1', { creates: [rec('a', 'IED')] })
		expect(await engine.listRecordIndexes('d1')).toEqual([])

		await engine.commit({
			documentId: 'd1',
			creates: [rec('b', 'LN')],
			updates: [],
			deletes: [],
			onProgress: () => {},
		})
		expect(await engine.listRecordIndexes('d1')).toHaveLength(4)
	})
})

describe('SqliteEngine — lean record (derived children, split namespace)', () => {
	let engine: SqliteEngine

	beforeEach(async () => {
		engine = await freshEngine()
	})

	it('derives children from parentId even though no children column is stored', async () => {
		await engine.registerDocument(doc('d1'))
		// Parent "p" is written with an EMPTY children array; the edge lives only on the child.
		await engine.bulkWrite('d1', {
			creates: [rec('p', 'IED'), rec('c', 'LN', { id: 'p', tagName: 'IED' })],
		})

		const p = (await engine.get('p', 'd1'))!
		expect(p.children).toEqual([{ id: 'c', tagName: 'LN' }])

		const fromDoc = (await engine.getByDocumentId('d1')).find((r) => r.id === 'p')!
		expect(fromDoc.children).toEqual([{ id: 'c', tagName: 'LN' }])
	})

	it('round-trips namespace via split columns', async () => {
		await engine.registerDocument(doc('d1'))
		await engine.bulkWrite('d1', { creates: [rec('a', 'IED')] })
		const a = (await engine.get('a', 'd1'))!
		expect(a.namespace).toEqual(NS)
	})
})
