import { testStoreFor } from './test-store-for'

import { describe, expect, it, onTestFinished } from 'vitest'

import { toDialecteError } from '@/errors'
import { EngineStore } from '@/store/sqlite/served/engine-store'
import { withoutSqliteStorage, withSqliteStorage } from '@/store/sqlite/sqlite-storage.fixtures'
import { registerStorageKind, replaceStorageKind } from '@/store/storage-kinds'
import {
	fakeKindOf,
	fakeStorageOf,
	fakeStore,
	outcomeOf,
	refusalOf,
	uniqueFakeType,
} from '@/store/storage-kinds.fixtures'
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
			withSqliteStorage()
			const store = await testStoreFor({ storage, name: 'kind-of', dialecte: TEST_DIALECTE })
			expected(store)
		})
	}

	it('sqlite, @dialecte/core/sqlite never imported (no setup file imports it) → PROJECT_STORAGE_NOT_REGISTERED', async () => {
		withoutSqliteStorage()
		const key = await testStoreFor({
			storage: { type: 'sqlite' },
			name: 'kind-of',
			dialecte: TEST_DIALECTE,
		}).then(
			function made() {
				return 'made'
			},
			function refused(thrown: unknown) {
				return toDialecteError(thrown)?.key
			},
		)
		expect(key).toBe('PROJECT_STORAGE_NOT_REGISTERED')
	})

	it('sqlite → a store that imports with the dialecte and reads back what it imported', async () => {
		withSqliteStorage()
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
			const recordCount = await store.count(record.id)
			expect(recordCount).toBe(2)
		} finally {
			await store.destroy()
		}
	})
})

describe('the store a test project opens on, by a registered kind', () => {
	/** The kind registered for the case, its type free again when the case ends. */
	function registerForCase(params: { type: string; kind: ReturnType<typeof fakeKindOf>['kind'] }) {
		const { type, kind } = params
		onTestFinished(replaceStorageKind({ type, kind: undefined }))
		registerStorageKind({ type: type as 'sqlite', kind: kind as never })
	}

	it('a kind with a testStoreOf → the store it answers, given the test project’s name, storage, dialecte and perf', async () => {
		const type = uniqueFakeType()
		const storage = fakeStorageOf({ type })
		const testStore = fakeStore()
		const fake = fakeKindOf({ id: 'fake@1', testStore })
		const registration = outcomeOf(function registerFake() {
			registerForCase({ type, kind: fake.kind })
		})
		const opened = await testStoreFor({
			storage,
			name: 'kind-registered',
			dialecte: TEST_DIALECTE,
			perf: true,
		}).catch((thrown: unknown) => ({ type: 'refused' as const, thrown }))

		expect(refusalOf(registration)).toBeUndefined()
		expect(registration).toHaveProperty('answered')
		expect(opened).toEqual({ type: 'custom', store: testStore })
		expect(opened.type === 'custom' && opened.store).toBe(testStore)
		expect(fake.testStoreOf).toHaveBeenCalledWith({
			name: 'kind-registered',
			storage,
			dialecte: {
				id: TEST_DIALECTE.id,
				configs: TEST_DIALECTE.configs,
				defaultConfigKey: TEST_DIALECTE.defaultConfigKey,
				createHooks: TEST_DIALECTE.createHooks,
			},
			perf: true,
		})
	})

	it('a kind without a testStoreOf → the storage param as it is', async () => {
		const type = uniqueFakeType()
		const storage = fakeStorageOf({ type })
		const fake = fakeKindOf({ id: 'fake@1' })
		const registration = outcomeOf(function registerFake() {
			registerForCase({ type, kind: fake.kind })
		})
		const opened = await testStoreFor({
			storage,
			name: 'kind-registered',
			dialecte: TEST_DIALECTE,
		}).catch((thrown: unknown) => ({ type: 'refused' as const, thrown }))

		expect(refusalOf(registration)).toBeUndefined()
		expect(registration).toHaveProperty('answered')
		expect(opened).toBe(storage)
	})

	it('a type no kind registered → PROJECT_STORAGE_NOT_REGISTERED', async () => {
		const type = uniqueFakeType()
		const key = await testStoreFor({
			storage: fakeStorageOf({ type }),
			name: 'kind-unregistered',
			dialecte: TEST_DIALECTE,
		}).then(
			function made() {
				return 'made'
			},
			function refused(thrown: unknown) {
				return toDialecteError(thrown)?.key
			},
		)

		expect(key).toBe('PROJECT_STORAGE_NOT_REGISTERED')
	})
})
