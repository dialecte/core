import { createProjectFactory } from './create-project-factory'
import { createCountingDialecte, ENGINE_URL } from './create-project-factory.fixtures'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

// The factory's default store: the local one, a database of the project's name in IndexedDB.

describe('createProjectFactory on IndexedDB', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		for (const project of projects) await project.destroy()
		projects.length = 0
	})

	it('without a storage choice the project opens on the local store', async () => {
		const factory = createProjectFactory({
			dialecte: createCountingDialecte(),
			engineUrl: ENGINE_URL,
		})
		const project = await factory().open(`factory-local-${crypto.randomUUID()}`)
		projects.push(project)
		const databaseExists = await Dexie.exists(project.name)
		expect(databaseExists).toBe(true)
	})
})
