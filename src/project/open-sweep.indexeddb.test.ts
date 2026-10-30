import { document, root } from './open-sweep.fixtures'
import { Project } from './project'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DexieStore } from '@/store/local/dexie-store'
import { TABLE_DOCUMENTS, recordTableName } from '@/store/store.constants'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'
import type Dexie from 'dexie'

// What `open()` does with the documents it finds on IndexedDB: a leftover import's table removed, a row
// stored before `status` existed read as ready.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

const LEFT = document({ id: 'left', status: 'importing' })

describe('Project.open on IndexedDB - the documents it finds', () => {
	const cleanups: Array<() => Promise<void> | void> = []
	afterEach(async () => {
		for (const fn of cleanups.splice(0)) await fn()
		vi.restoreAllMocks()
	})

	it('IndexedDB: the leftover removed with its table, a row stored before `status` existed reads as ready', async () => {
		const name = `open-sweep-${crypto.randomUUID()}`
		const seed = new DexieStore(name, { recordSchema: CONFIG.database.recordSchema })
		await seed.open()
		await seed.registerDocument(LEFT)
		await seed.bulkWrite(LEFT.id, { creates: [root({ documentId: LEFT.id })] })
		// a document written by a core without `status`: the raw row, no field
		const legacy = document({ id: 'legacy', status: 'ready' })
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
		const legacyDocument = await project.getDocument('legacy')
		expect(legacyDocument).toEqual(expect.objectContaining({ status: 'ready' }))
		expect(getHistoryStatus).toHaveBeenCalledTimes(1)
		expect(getHistoryStatus).toHaveBeenCalledWith('legacy')

		const dexie = (project as unknown as { store: DexieStore }).store.getDatabaseInstance() as Dexie
		expect(dexie.tables.map((table) => table.name)).not.toContain(recordTableName('left'))
		const leftRow = await dexie.table(TABLE_DOCUMENTS).get('left')
		expect(leftRow).toBeUndefined()
	})
})
