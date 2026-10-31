import { EngineStore } from './engine/engine-store'
import { resolveStore, sqliteConnectorParamsOf } from './resolve-store'

import { describe, it, expect, vi } from 'vitest'

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

/** The runtime of a dialecte's project factory: its engine's version and address besides. */
const SQLITE_RUNTIME = {
	...RUNTIME,
	dialecteVersion: '0.0.0',
	engineUrl: 'https://dialecte.test/assets/engine.worker.js',
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
		'sqlite storage, with the dialecte’s engine → an EngineStore': {
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
			testCase.expected(
				resolveStore({
					name: 'resolve-store',
					storage: testCase.storage,
					runtime: SQLITE_RUNTIME,
					dialecteId: 'core/test',
				}),
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
			runtime: typeof RUNTIME & { dialecteVersion?: string; engineUrl?: string }
			dialecteId: string | undefined
		}
		const refusals: Record<string, RefusalCase> = {
			'a project made by no dialecte → PROJECT_ENGINE_NOT_DECLARED, no store made': {
				runtime: RUNTIME,
				dialecteId: undefined,
			},
			'a dialecte with no engine address → PROJECT_ENGINE_NOT_DECLARED': {
				runtime: { ...RUNTIME, dialecteVersion: '0.0.0' },
				dialecteId: 'core/test',
			},
			'a dialecte with no version → PROJECT_ENGINE_NOT_DECLARED': {
				runtime: { ...RUNTIME, engineUrl: SQLITE_RUNTIME.engineUrl },
				dialecteId: 'core/test',
			},
		}
		for (const [description, { runtime, dialecteId }] of Object.entries(refusals)) {
			it(description, () => {
				let thrown: unknown
				try {
					resolveStore({ name: 'resolve-store', storage: { type: 'sqlite' }, runtime, dialecteId })
				} catch (error) {
					thrown = error
				}
				expect(toDialecteError(thrown)?.key).toBe('PROJECT_ENGINE_NOT_DECLARED')
			})
		}

		it('opened where there is no worker and no private file system (node) → STORE_UNAVAILABLE, nothing started', async () => {
			const store = resolveStore({
				name: `resolve-store-${crypto.randomUUID()}`,
				storage: { type: 'sqlite' },
				runtime: SQLITE_RUNTIME,
				dialecteId: 'core/test',
			})
			const outcome = await store.open().then(
				function opened() {
					return 'opened'
				},
				function refused(error: unknown) {
					return toDialecteError(error)?.key
				},
			)
			expect(outcome).toBe('STORE_UNAVAILABLE')
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
			'a factory’s project, measured → its name, dialecte, version, engine and perf': {
				name: 'measured',
				dialecteId: 'core/test',
				perf: true,
				expected: {
					params: {
						name: 'measured',
						dialecteId: 'core/test',
						dialecteVersion: SQLITE_RUNTIME.dialecteVersion,
						engineUrl: SQLITE_RUNTIME.engineUrl,
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
})
