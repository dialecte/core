import { resolveStore } from './resolve-store'
import { EngineStore } from './sqlite/served/engine-store'
import { sqliteConnectorParamsOf } from './sqlite/sqlite-storage-kind'
import { withoutSqliteStorage, withSqliteStorage } from './sqlite/sqlite-storage.fixtures'
import { replaceStorageKind, registerStorageKind } from './storage-kinds'
import { STORAGE_KINDS_VERSION } from './storage-kinds.constants'
import {
	answerOf,
	fakeKindOf,
	fakeStorageOf,
	outcomeOf,
	refusalOf,
	uniqueFakeType,
} from './storage-kinds.fixtures'

import { describe, it, expect, onTestFinished, vi } from 'vitest'

import '@/sqlite'
import { toDialecteError } from '@/errors'
import { DexieStore, InMemoryStore } from '@/store'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { StorageParam } from '../project/types'
import type { Store } from '@/store'
import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const NS = CONFIG.namespaces.default.uri

/** The runtime given: core's test config, an import session with one thing to say. */
const RUNTIME = {
	configs: { default: CONFIG },
	defaultConfigKey: 'default',
	hooks: {
		createImportSession: () => ({
			afterImport: async () => ({
				diagnostics: [
					{
						code: 'said',
						severity: 'information' as const,
						source: 'resolve-store',
						message: 'The runtime given was used',
						ref: { tagName: 'Root', id: 'root' },
					},
				],
			}),
		}),
	},
}

/** The runtime of a dialecte's project factory: its version besides. */
const SQLITE_RUNTIME = {
	...RUNTIME,
	dialecteVersion: '0.0.0',
}

/** The store resolveStore builds, or the error it refuses with: a refusal then fails the case on its assertion. */
function resolvedOrRefused(params: Parameters<typeof resolveStore>[0]): unknown {
	try {
		return resolveStore(params)
	} catch (thrown) {
		return thrown
	}
}

describe('resolveStore', () => {
	const custom = { open: vi.fn() } as unknown as Store

	type TestCase = {
		storage: StorageParam
		expected: (store: Store) => void
	}
	const testCases: Record<string, TestCase> = {
		'local storage → a DexieStore': {
			storage: { type: 'local' },
			expected: (store) => expect(store).toBeInstanceOf(DexieStore),
		},
		'inMemory storage → an InMemoryStore': {
			storage: { type: 'inMemory', writable: false },
			expected: (store) => expect(store).toBeInstanceOf(InMemoryStore),
		},
		'sqlite storage, made by a dialecte’s factory → an EngineStore': {
			storage: { type: 'sqlite' },
			expected: (store) => expect(store).toBeInstanceOf(EngineStore),
		},
		'custom storage → the store given': {
			storage: { type: 'custom', store: custom },
			expected: (store) => expect(store).toBe(custom),
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, () => {
			withSqliteStorage()
			testCase.expected(
				resolvedOrRefused({
					name: 'resolve-store',
					storage: testCase.storage,
					runtime: SQLITE_RUNTIME,
					dialecteId: 'core/test',
				}) as Store,
			)
		})
	}

	it('the store it builds imports with the runtime given', async () => {
		const store = resolveStore({
			name: `resolve-store-${crypto.randomUUID()}`,
			storage: { type: 'inMemory' },
			runtime: RUNTIME,
		})
		await store.open()

		const result = await store.importFile({
			file: new File([`<Root xmlns="${NS}"/>`], 'given.xml', { type: 'text/xml' }),
		})

		expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['said'])
	})

	describe('sqlite storage', () => {
		type RefusalCase = {
			runtime: typeof RUNTIME & { dialecteVersion?: string }
			dialecteId: string | undefined
		}
		const refusals: Record<string, RefusalCase> = {
			'a project made by no dialecte → PROJECT_ENGINE_NOT_DECLARED, no store made': {
				runtime: RUNTIME,
				dialecteId: undefined,
			},
			'a dialecte with no version → PROJECT_ENGINE_NOT_DECLARED': {
				runtime: RUNTIME,
				dialecteId: 'core/test',
			},
		}
		for (const [description, { runtime, dialecteId }] of Object.entries(refusals)) {
			it(description, () => {
				withSqliteStorage()
				let thrown: unknown
				try {
					resolveStore({ name: 'resolve-store', storage: { type: 'sqlite' }, runtime, dialecteId })
				} catch (error) {
					thrown = error
				}
				expect(toDialecteError(thrown)?.key).toBe('PROJECT_ENGINE_NOT_DECLARED')
			})
		}
	})

	describe('the sqlite storage kind, registered by importing @dialecte/core/sqlite', () => {
		type RegistrationCase = {
			dialecteId: string | undefined
			runtime: typeof SQLITE_RUNTIME | typeof RUNTIME
		}
		const notImported: Record<string, RegistrationCase> = {
			'the app never imported @dialecte/core/sqlite → PROJECT_STORAGE_NOT_REGISTERED, naming the type':
				{
					dialecteId: 'core/test',
					runtime: SQLITE_RUNTIME,
				},
			'never imported, a project made by no dialecte → PROJECT_STORAGE_NOT_REGISTERED first: no kind is known':
				{
					dialecteId: undefined,
					runtime: RUNTIME,
				},
		}
		for (const [description, { dialecteId, runtime }] of Object.entries(notImported)) {
			it(description, () => {
				withoutSqliteStorage()
				let thrown: unknown
				try {
					resolveStore({ name: 'resolve-store', storage: { type: 'sqlite' }, runtime, dialecteId })
				} catch (error) {
					thrown = error
				}
				const error = toDialecteError(thrown)
				expect(error?.key).toBe('PROJECT_STORAGE_NOT_REGISTERED')
				expect(error?.meta).toEqual({ project: 'resolve-store', type: 'sqlite' })
			})
		}

		it('registered → the store its storeOf builds, given the name, the storage, the runtime and the dialecte id', () => {
			const { kind, storeOf, built } = fakeKindOf({ id: 'fake-sqlite@1' })
			const storage = { type: 'sqlite' } as const
			const outcome = outcomeOf(function resolveRegistered() {
				onTestFinished(replaceStorageKind({ type: 'sqlite', kind }))
				return resolveStore({
					name: 'resolve-store',
					storage,
					runtime: SQLITE_RUNTIME,
					dialecteId: 'core/test',
				})
			})

			expect(answerOf(outcome)).toBe(built)
			expect(storeOf).toHaveBeenCalledWith({
				name: 'resolve-store',
				storage,
				runtime: SQLITE_RUNTIME,
				dialecteId: 'core/test',
			})
		})
	})

	describe('what a project on sqlite connects with', () => {
		type TestCase = {
			name: string
			dialecteId: string | undefined
			perf?: boolean
			expected: { refusedWith: string } | { params: unknown }
		}
		const testCases: Record<string, TestCase> = {
			'a factory’s project, measured → its name, dialecte, version and perf': {
				name: 'measured',
				dialecteId: 'core/test',
				perf: true,
				expected: {
					params: {
						name: 'measured',
						dialecteId: 'core/test',
						dialecteVersion: SQLITE_RUNTIME.dialecteVersion,
						perf: true,
					},
				},
			},
			'a dialecte id of `..` → PROJECT_NAME_INVALID before anything is loaded': {
				name: 'named',
				dialecteId: '..',
				expected: { refusedWith: 'PROJECT_NAME_INVALID' },
			},
			'an empty name, made by no factory → PROJECT_NAME_INVALID first': {
				name: '',
				dialecteId: undefined,
				expected: { refusedWith: 'PROJECT_NAME_INVALID' },
			},
		}
		for (const [description, { name, dialecteId, perf, expected }] of Object.entries(testCases)) {
			it(description, () => {
				let answered: unknown
				let thrown: unknown
				try {
					answered = sqliteConnectorParamsOf({
						name,
						dialecteId,
						runtime: { ...SQLITE_RUNTIME, perf },
					})
				} catch (error) {
					thrown = error
				}
				if ('refusedWith' in expected) {
					expect(toDialecteError(thrown)?.key).toBe(expected.refusedWith)
				} else {
					expect(answered).toEqual(expected.params)
				}
			})
		}
	})

	describe('a storage kind registered by type', () => {
		it('a registered type → the store its storeOf builds, given the name, the storage as given, the runtime and the dialecte id', () => {
			const type = uniqueFakeType()
			const storage = fakeStorageOf({ type })
			const { kind, storeOf, built } = fakeKindOf({ id: 'fake@1' })
			const outcome = outcomeOf(function resolveRegistered() {
				onTestFinished(replaceStorageKind({ type, kind: undefined }))
				registerStorageKind({ type: type as 'sqlite', kind: kind as never })
				return resolveStore({
					name: 'resolve-registered',
					storage,
					runtime: RUNTIME,
					dialecteId: 'core/test',
				})
			})

			expect(answerOf(outcome)).toBe(built)
			expect(storeOf).toHaveBeenCalledTimes(1)
			expect(storeOf).toHaveBeenCalledWith({
				name: 'resolve-registered',
				storage,
				runtime: RUNTIME,
				dialecteId: 'core/test',
			})
			expect(storeOf.mock.calls[0]?.[0].storage).toBe(storage)
		})

		it('a type no kind registered → PROJECT_STORAGE_NOT_REGISTERED, naming the type and the project', () => {
			const type = uniqueFakeType()
			const outcome = outcomeOf(function resolveUnregistered() {
				return resolveStore({
					name: 'resolve-unregistered',
					storage: fakeStorageOf({ type }),
					runtime: RUNTIME,
					dialecteId: 'core/test',
				})
			})

			const refusal = refusalOf(outcome)
			expect({ key: refusal?.key, meta: refusal?.meta }).toEqual({
				key: 'PROJECT_STORAGE_NOT_REGISTERED',
				meta: { project: 'resolve-unregistered', type },
			})
		})

		it('a kind put on the registry of the realm by another copy of the library of the same version → the one resolveStore serves', () => {
			const type = uniqueFakeType()
			const { kind, built } = fakeKindOf({ id: 'other-copy@1' })
			const realm = globalThis as unknown as Record<symbol, Map<string, unknown> | undefined>
			// the key another copy of this version computes for itself
			const key = Symbol.for(`@dialecte/core/storage-kinds/v${STORAGE_KINDS_VERSION}`)
			const existing = realm[key]
			const registry = existing ?? new Map<string, unknown>()
			realm[key] = registry
			registry.set(type, kind)
			onTestFinished(function leaveRegistry() {
				registry.delete(type)
				if (!existing) delete realm[key]
			})
			const outcome = outcomeOf(function resolveFromOtherCopy() {
				return resolveStore({
					name: 'resolve-other-copy',
					storage: fakeStorageOf({ type }),
					runtime: RUNTIME,
					dialecteId: 'core/test',
				})
			})

			expect(answerOf(outcome)).toBe(built)
		})

		it('a local entry put on the registry of the realm → ignored: the built-in kinds come first, local still resolves to a DexieStore', () => {
			const { kind } = fakeKindOf({ id: 'other-copy-local@1' })
			const realm = globalThis as unknown as Record<symbol, Map<string, unknown> | undefined>
			// the key another copy of this version computes for itself
			const key = Symbol.for(`@dialecte/core/storage-kinds/v${STORAGE_KINDS_VERSION}`)
			const existing = realm[key]
			const registry = existing ?? new Map<string, unknown>()
			realm[key] = registry
			const before = registry.get('local')
			registry.set('local', kind)
			onTestFinished(function leaveRegistry() {
				if (before === undefined) registry.delete('local')
				else registry.set('local', before)
				if (!existing) delete realm[key]
			})
			const outcome = outcomeOf(function resolveLocal() {
				return resolveStore({
					name: 'resolve-local-first',
					storage: { type: 'local' },
					runtime: RUNTIME,
					dialecteId: 'core/test',
				})
			})

			expect(answerOf(outcome)).toBeInstanceOf(DexieStore)
		})

		it('the refusal of an unregistered type → its detail names the type, says to import the entry that registers it, and names the other-copy cause, no store', () => {
			const type = uniqueFakeType()
			const outcome = outcomeOf(function resolveUnregistered() {
				return resolveStore({
					name: 'resolve-unregistered-detail',
					storage: fakeStorageOf({ type }),
					runtime: RUNTIME,
					dialecteId: 'core/test',
				})
			})

			const detail = refusalOf(outcome)?.detail ?? ''
			expect({
				namesType: detail.includes(type),
				importsEntry: detail.includes('import the entry that registers it'),
				otherCopy: detail.includes('a copy of @dialecte/core of another'),
				namesStore: /sqlite|indexeddb|dexie/i.test(detail),
			}).toEqual({ namesType: true, importsEntry: true, otherCopy: true, namesStore: false })
		})
	})
})
