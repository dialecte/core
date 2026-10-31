import { testStoreFor } from './test-store-for'

import { describe, expect, it } from 'vitest'

import { EngineStore } from '@/store/engine/engine-store'
import { TEST_DIALECTE, XMLNS_DEFAULT_NAMESPACE } from '@/test'

import type { StorageParam } from '@/project'

const SOURCE_XML = `<Root ${XMLNS_DEFAULT_NAMESPACE}><A aA="1"/></Root>`

describe('the store a test project opens on, by its kind', () => {
	type TestCase = { storage: StorageParam; expected: (storage: StorageParam) => void }
	const testCases: Record<string, TestCase> = {
		'sqlite → the SQLite engine in this realm (in process), on the test project’s name and dialecte':
			{
				storage: { type: 'sqlite' },
				expected: function isInProcessEngine(storage) {
					expect(storage.type).toBe('custom')
					expect(storage.type === 'custom' && storage.store).toBeInstanceOf(EngineStore)
					expect(storage.type === 'custom' && storage.store.name).toBe('kind-of')
				},
			},
		'local → as it is': {
			storage: { type: 'local' },
			expected: function isLocal(storage) {
				expect(storage).toEqual({ type: 'local' })
			},
		},
		'in memory → as it is': {
			storage: { type: 'inMemory', writable: false },
			expected: function isInMemory(storage) {
				expect(storage).toEqual({ type: 'inMemory', writable: false })
			},
		},
	}
	for (const [description, { storage, expected }] of Object.entries(testCases)) {
		it(description, async () => {
			expected(await testStoreFor({ storage, name: 'kind-of', dialecte: TEST_DIALECTE }))
		})
	}

	it('sqlite → a store that imports with the dialecte and reads back what it imported', async () => {
		const storage = await testStoreFor({
			storage: { type: 'sqlite' },
			name: `kind-of-${crypto.randomUUID()}`,
			dialecte: TEST_DIALECTE,
		})
		if (storage.type !== 'custom') throw new Error('not a store')
		const { store } = storage
		await store.open()
		try {
			const { record } = await store.importFile({
				file: new File([SOURCE_XML], 'source.xml', { type: 'text/xml' }),
			})
			expect(await store.count(record.id)).toBe(2)
		} finally {
			await store.destroy()
		}
	})
})
