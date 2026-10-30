import { XMLNS_DEFAULT_NAMESPACE } from './constant'
import { createTestHelpers } from './create-test-helpers'
import { TEST_DIALECTE } from './test-dialecte'

import Dexie from 'dexie'
import { afterEach, expect, it } from 'vitest'

// Where createTestProject opens when the local store is a case: a database of the project's name in IndexedDB.

const VALID_XML = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE}><A aA="ONE"/></Root>`

const projects: Array<{ destroy: () => Promise<void> }> = []

afterEach(async () => {
	for (const project of projects) await project.destroy()
	projects.length = 0
})

const storageCases: Record<string, { helperStorage?: 'inMemory'; callStorage?: 'local' }> = {
	'the call storage over the helpers one': { helperStorage: 'inMemory', callStorage: 'local' },
	'the local store when neither names one': {},
}

for (const [description, { helperStorage, callStorage }] of Object.entries(storageCases)) {
	it(`createTestProject runs on ${description}`, async () => {
		const bound = createTestHelpers({
			dialecte: TEST_DIALECTE,
			storage: helperStorage ? { type: helperStorage } : undefined,
		})
		const { project } = await bound.createTestProject({
			sourceXml: VALID_XML,
			...(callStorage ? { storage: { type: callStorage } } : {}),
		})
		projects.push(project)
		const databaseExists = await Dexie.exists(project.name)
		expect(databaseExists).toBe(true)
	})
}
