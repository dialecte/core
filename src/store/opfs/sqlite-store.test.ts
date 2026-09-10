import { SqliteStore } from './sqlite-store'

import { describe, expect, it } from 'vitest'

import type { RecordSchema } from '../store.types'
import type { DocumentRecord } from '@/project/types'
import type { AnyRawRecord } from '@/types'

const SCHEMA: RecordSchema = {
	primaryKey: 'id',
	indexes: ['tagName', 'parent.id', 'parent.tagName'],
	compoundIndexes: [['id', 'tagName']],
	arrayIndexes: ['children.id', 'children.tagName'],
}

const NS = { prefix: '', uri: 'urn:x' }

function doc(id: string): DocumentRecord {
	return { id, name: id, extension: '.scd', configKey: 'default', createdAt: 1 }
}

function rec(id: string, tagName: string): AnyRawRecord {
	return {
		id,
		tagName,
		namespace: NS,
		value: '',
		parent: null,
		attributes: [],
		children: [],
	} as AnyRawRecord
}

async function open(): Promise<SqliteStore> {
	const store = new SqliteStore('proj', { recordSchema: SCHEMA, mode: 'memory' })
	await store.open()
	return store
}

describe('SqliteStore (memory mode)', () => {
	it('delegates the import + read path through the Store interface', async () => {
		const store = await open()
		await store.registerDocument(doc('d1'))
		await store.beginImport('d1')
		await store.bulkWrite('d1', { creates: [rec('a', 'IED'), rec('b', 'LN')] })
		await store.finalizeImport('d1')

		expect(await store.getByDocumentId('d1')).toHaveLength(2)
		expect((await store.get('a', 'd1'))!.tagName).toBe('IED')
		expect(await store.getDatabaseInstance()).toBeNull()
		await store.close()
	})

	it('commit reports progress through the (proxied) callback', async () => {
		const store = await open()
		await store.registerDocument(doc('d1'))
		await store.bulkWrite('d1', { creates: [rec('a', 'IED')] })

		const progress: Array<[number, number]> = []
		await store.commit({
			documentId: 'd1',
			creates: [rec('b', 'LN')],
			updates: [],
			deletes: [],
			onProgress: (c, t) => progress.push([c, t]),
		})
		expect(progress.at(-1)).toEqual([1, 1])
		expect(await store.getByDocumentId('d1')).toHaveLength(2)
		await store.close()
	})
})
