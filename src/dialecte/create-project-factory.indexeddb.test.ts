import { createProjectFactory } from './create-project-factory'
import { createCountingDialecte } from './create-project-factory.fixtures'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { rejectionKey } from '@/errors/errors.fixtures'

// The factory's default store: the local one, a database of the project's name in IndexedDB.

describe('createProjectFactory on IndexedDB', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		for (const project of projects) await project.destroy()
		projects.length = 0
	})

	it('without a storage choice the project opens on the local store', async () => {
		const factory = createProjectFactory({ dialecte: createCountingDialecte() })
		const project = await factory().open(`factory-local-${crypto.randomUUID()}`)
		projects.push(project)
		const databaseExists = await Dexie.exists(project.name)
		expect(databaseExists).toBe(true)
	})

	it('destroyProject on local storage → the project’s database deleted', async () => {
		const factory = createProjectFactory({ dialecte: createCountingDialecte() })
		const name = `factory-destroy-local-${crypto.randomUUID()}`
		const project = await factory({ storage: { type: 'local' } }).open(name)
		await project.close()
		const existedBefore = await Dexie.exists(name)

		const destroyed = await rejectionKey({
			action: factory.destroyProject({ name, storage: { type: 'local' } }),
		})
		const existsAfter = await Dexie.exists(name)

		expect({ existedBefore, destroyed, existsAfter }).toEqual({
			existedBefore: true,
			destroyed: 'resolved',
			existsAfter: false,
		})
	})
})
