import { TEST_DIALECTE_CONFIG } from './config'
import { createTestContext, createTestProject } from './create-test-dialecte'

import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'

import { InMemoryStore } from '@/store'

// The test projects on the local store: IndexedDB holds a database per project, which a destroy removes.

const SIMPLE_XML = /* xml */ `
	<Root>
		<A aA="a1" />
	</Root>
`

describe('createTestProject on the local store', () => {
	it('destroy → the project database removed', async () => {
		const { project } = await createTestProject({
			sourceXml: SIMPLE_XML,
			storage: { type: 'local' },
		})
		await project.destroy()
		const databaseExists = await Dexie.exists(project.name)
		expect(databaseExists).toBe(false)
	})
})

describe('createTestProject - a local project the test leaves undestroyed', () => {
	// the cases of this block run in order: the second checks what the first left
	const left: { local?: string } = {}

	it('a local project opened in the test → its database there while the test runs', async () => {
		const { project } = await createTestProject({
			sourceXml: SIMPLE_XML,
			storage: { type: 'local' },
		})
		left.local = project.name
		const databaseExists = await Dexie.exists(project.name)
		expect(databaseExists).toBe(true)
	})

	it('the test before has ended → its database removed', async () => {
		// run alone (`-t`, `.only`) the test before has left nothing to check
		expect(left.local).toBeDefined()
		const databaseExists = await Dexie.exists(left.local ?? '')
		expect(databaseExists).toBe(false)
	})
})

describe('createTestContext on a store given, in a browser', () => {
	it('a store given → no local database opened under its name', async () => {
		const store = new InMemoryStore('context-store-given', { writable: true })
		await store.open()
		const context = await createTestContext({
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: 'doc',
			store,
		})
		expect(context.store).toBe(store)
		const databaseExists = await Dexie.exists('context-store-given')
		expect(databaseExists).toBe(false)
		await store.destroy()
	})
})
