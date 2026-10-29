import { document, root } from './open-sweep.fixtures'
import { Project } from './project'

import { afterEach, describe, expect, it } from 'vitest'

import { InMemoryStore } from '@/store/in-memory/in-memory-store'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'

// What `open()` does with the documents it finds: a finished one is opened; one an import left
// `importing` is removed by the store as it opens - an import never outlives the store that ran
// it; one stored before `status` existed is a finished one.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const RUNTIME = { configs: { default: CONFIG }, defaultConfigKey: 'default' }

const READY = document({ id: 'ready', status: 'ready' })
const LEFT = document({ id: 'left', status: 'importing' })

describe('Project.open - the documents it finds', () => {
	const cleanups: Array<() => Promise<void> | void> = []
	afterEach(async () => {
		for (const fn of cleanups.splice(0)) await fn()
	})

	it('in memory: a ready document and an import left unfinished → ready opened, the leftover removed with its records', async () => {
		const store = new InMemoryStore('open-sweep', { runtime: RUNTIME })
		await store.open()
		for (const record of [READY, LEFT]) {
			await store.registerDocument(record)
			await store.bulkWrite(record.id, { creates: [root({ documentId: record.id })] })
		}

		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'custom', store },
		}).open('open-sweep')
		cleanups.push(() => project.destroy())

		expect([...project.state.documents.keys()]).toEqual(['ready'])
		const projectDocuments = await project.getDocuments()
		expect(projectDocuments.map((listed) => listed.id)).toEqual(['ready'])
		const storeDocuments = await store.getDocuments()
		expect(storeDocuments.map((listed) => listed.id)).toEqual(['ready'])
		const leftRecords = await store.getByDocumentId('left')
		expect(leftRecords).toEqual([])
		const leftOutcome = await store.getWriteOutcome({ writeId: LEFT.writeId! })
		expect(leftOutcome).toBe('not-applied')
	})
})
