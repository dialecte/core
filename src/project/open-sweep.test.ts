import { Project } from './project'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { InMemoryStore } from '@/store/in-memory/in-memory-store'
import { DexieStore } from '@/store/local/dexie-store'
import { TABLE_DOCUMENTS, recordTableName } from '@/store/store.constants'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { DocumentRecord } from './types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'
import type Dexie from 'dexie'

// What `open()` does with the documents it finds: a finished one is opened; one an import left
// `importing` is removed by the store as it opens - an import never outlives the store that ran
// it; one stored before `status` existed is a finished one.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUNTIME = { configs: { default: CONFIG }, defaultConfigKey: 'default' }

function document(id: string, status: DocumentRecord['status']): DocumentRecord {
	return {
		id,
		name: id,
		extension: '.xml',
		configKey: 'default',
		createdAt: 1,
		status,
		writeId: `write-${id}`,
	}
}

function root(documentId: string): AnyRawRecord {
	return {
		id: `${documentId}-root`,
		tagName: 'Root',
		namespace: CONFIG.namespaces.default,
		value: '',
		attributes: [],
		parent: null,
		children: [],
	}
}

const READY = document('ready', 'ready')
const LEFT = document('left', 'importing')

describe('Project.open - the documents it finds', () => {
	const cleanups: Array<() => Promise<void> | void> = []
	afterEach(async () => {
		for (const fn of cleanups.splice(0)) await fn()
		vi.restoreAllMocks()
	})

	it('in memory: a ready document and an import left unfinished → ready opened, the leftover removed with its records', async () => {
		const store = new InMemoryStore('open-sweep', { runtime: RUNTIME })
		await store.open()
		for (const record of [READY, LEFT]) {
			await store.registerDocument(record)
			await store.bulkWrite(record.id, { creates: [root(record.id)] })
		}

		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'custom', store },
		}).open('open-sweep')
		cleanups.push(() => project.destroy())

		expect([...project.state.documents.keys()]).toEqual(['ready'])
		expect((await project.getDocuments()).map((d) => d.id)).toEqual(['ready'])
		expect((await store.getDocuments()).map((d) => d.id)).toEqual(['ready'])
		expect(await store.getByDocumentId('left')).toEqual([])
		expect(await store.getWriteOutcome({ writeId: LEFT.writeId! })).toBe('not-applied')
	})

	it('IndexedDB: the leftover removed with its table, a row stored before `status` existed reads as ready', async () => {
		const name = `open-sweep-${crypto.randomUUID()}`
		const seed = new DexieStore(name, { recordSchema: CONFIG.database.recordSchema })
		await seed.open()
		await seed.registerDocument(LEFT)
		await seed.bulkWrite(LEFT.id, { creates: [root(LEFT.id)] })
		// a document written by a core without `status`: the raw row, no field
		const legacy = document('legacy', 'ready')
		await seed.registerDocument(legacy)
		const { status: _dropped, ...legacyRow } = legacy
		await (seed.getDatabaseInstance() as Dexie).table(TABLE_DOCUMENTS).put(legacyRow)
		seed.close()

		const getHistoryStatus = vi.spyOn(DexieStore.prototype, 'getHistoryStatus')
		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'local' },
		}).open(name)
		cleanups.push(() => project.destroy())

		expect([...project.state.documents.keys()]).toEqual(['legacy'])
		expect(await project.getDocument('legacy')).toEqual(
			expect.objectContaining({ status: 'ready' }),
		)
		expect(getHistoryStatus).toHaveBeenCalledTimes(1)
		expect(getHistoryStatus).toHaveBeenCalledWith('legacy')

		const dexie = (project as unknown as { store: DexieStore }).store.getDatabaseInstance() as Dexie
		expect(dexie.tables.map((t) => t.name)).not.toContain(recordTableName('left'))
		expect(await dexie.table(TABLE_DOCUMENTS).get('left')).toBeUndefined()
	})
})
