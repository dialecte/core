import { Project } from './project'
import { STALE_IMPORT_MS } from './state/document-lifecycle'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { InMemoryStore } from '@/store/in-memory/in-memory-store'
import { DexieStore } from '@/store/local/dexie-store'
import { TABLE_DOCUMENTS, recordTableName } from '@/store/store.constants'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { DocumentRecord } from './types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'
import type Dexie from 'dexie'

// What `open()` does with the documents it finds: a finished one is opened; one still importing is
// never opened - removed when its import died (stale heartbeat), left alone when it is alive in
// another realm; one stored before `status` existed is a finished one.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

function document(
	id: string,
	status: DocumentRecord['status'],
	importingAt?: number,
): DocumentRecord {
	return {
		id,
		name: id,
		extension: '.xml',
		configKey: 'default',
		createdAt: 1,
		status,
		importingAt,
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

const now = Date.now()
const READY = document('ready', 'ready')
const DEAD = document('dead', 'importing', now - STALE_IMPORT_MS - 1_000)
const ALIVE = document('alive', 'importing', now)

describe('Project.open - the documents it finds', () => {
	const cleanups: Array<() => Promise<void> | void> = []
	afterEach(async () => {
		for (const fn of cleanups.splice(0)) await fn()
		vi.restoreAllMocks()
	})

	it('in memory: ready, dead import, live import → ready opened, dead removed, live kept but hidden', async () => {
		const store = new InMemoryStore('open-sweep', { writable: true })
		await store.open()
		for (const record of [READY, DEAD, ALIVE]) {
			await store.registerDocument(record)
			await store.bulkWrite(record.id, { creates: [root(record.id)] })
		}

		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'custom', store },
		}).open('open-sweep')
		cleanups.push(() => project.close())

		expect([...project.state.documents.keys()]).toEqual(['ready'])
		expect((await project.getDocuments()).map((d) => d.id)).toEqual(['ready'])
		expect(await project.getDocument('alive')).toBeUndefined()
		expect(await project.getDocumentStatus('alive')).toEqual({ live: false, ready: false })
		// the store: the dead import is gone with its records, the live one untouched
		expect((await store.getDocuments()).map((d) => d.id).sort()).toEqual(['alive', 'ready'])
		expect(await store.getByDocumentId('dead')).toEqual([])
		expect(await store.getByDocumentId('alive')).toHaveLength(1)
	})

	it('in memory: an import whose heartbeat stops while the project is open → removed at the next periodic sweep', async () => {
		vi.useFakeTimers()
		try {
			const store = new InMemoryStore('open-sweep', { writable: true })
			await store.open()
			const alive = document('alive', 'importing', Date.now())
			await store.registerDocument(alive)
			await store.bulkWrite(alive.id, { creates: [root(alive.id)] })

			const project = await new Project({
				configs: { default: CONFIG },
				storage: { type: 'custom', store },
			}).open('open-sweep')
			cleanups.push(() => project.close())

			expect((await store.getDocuments()).map((d) => d.id)).toEqual(['alive'])
			// the realm that imported it died after we opened: its heartbeat stays where it was
			await store.updateDocument('alive', { importingAt: Date.now() - STALE_IMPORT_MS - 1_000 })
			await vi.advanceTimersByTimeAsync(STALE_IMPORT_MS + 1_000)
			expect(await store.getDocuments()).toEqual([])
			expect(await store.getByDocumentId('alive')).toEqual([])
		} finally {
			vi.useRealTimers()
		}
	})

	it('IndexedDB: dead import removed with its table, live import hidden, a row stored before `status` existed reads as ready', async () => {
		const name = `open-sweep-${crypto.randomUUID()}`
		const seed = new DexieStore(name, { recordSchema: CONFIG.database.recordSchema })
		await seed.open()
		for (const record of [DEAD, ALIVE]) {
			await seed.registerDocument(record)
			await seed.bulkWrite(record.id, { creates: [root(record.id)] })
		}
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

		expect((await project.getDocuments()).map((d) => d.id)).toEqual(['legacy'])
		const dexie = (project as unknown as { store: DexieStore }).store.getDatabaseInstance() as Dexie
		expect(dexie.tables.map((t) => t.name)).not.toContain(recordTableName('dead'))
		expect(await dexie.table(TABLE_DOCUMENTS).get('dead')).toBeUndefined()
		expect(await dexie.table(TABLE_DOCUMENTS).get('alive')).toEqual(
			expect.objectContaining({ status: 'importing' }),
		)
	})
})
