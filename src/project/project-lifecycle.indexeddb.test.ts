import { document } from './open-sweep.fixtures'
import { Project } from './project'

import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'

import { createDialecteError } from '@/errors'
import { rejectionKey } from '@/errors/errors.fixtures'
import { DexieStore } from '@/store/local/dexie-store'
import { SQLITE_ERRORS } from '@/store/sqlite/sqlite-errors.constants'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'

// The reset of a project its store refused to open, on IndexedDB: destroy() on that Project deletes the database
// through the store that was never opened.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

/** An IndexedDB store refusing to open, as a store whose database is lost does. */
class RefusingDexieStore extends DexieStore {
	override async open(): Promise<void> {
		throw createDialecteError(SQLITE_ERRORS.PROJECT_DATABASE_LOST, {
			detail: `Project "${this.name}" holds data but its database is gone`,
			meta: { project: this.name },
		})
	}
}

describe('Project on IndexedDB - an open its store refuses, then destroy() on that Project', () => {
	it('→ the database deleted, never opened by the Project', async () => {
		const name = `lifecycle-${crypto.randomUUID()}`
		const seed = new DexieStore(name, { recordSchema: CONFIG.database.recordSchema })
		await seed.open()
		await seed.registerDocument(document({ id: 'kept', status: 'ready' }))
		seed.close()
		const existsBefore = await Dexie.exists(name)
		expect(existsBefore).toBe(true)
		const store = new RefusingDexieStore(name, { recordSchema: CONFIG.database.recordSchema })
		const project = new Project({
			configs: { default: CONFIG },
			storage: { type: 'custom', store },
		})
		const openRejection = await rejectionKey({ action: project.open(name) })
		expect(openRejection).toBe('PROJECT_DATABASE_LOST')
		await project.destroy()
		const existsAfter = await Dexie.exists(name)
		expect(existsAfter).toBe(false)
	})
})
