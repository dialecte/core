import { resolveStore } from './resolve-store'

import { describe, it, expect, vi } from 'vitest'

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
		'custom storage → the store given': {
			storage: { type: 'custom', store: custom },
			expected: (store) => expect(store).toBe(custom),
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, () => {
			testCase.expected(
				resolveStore({ name: 'resolve-store', storage: testCase.storage, runtime: RUNTIME }),
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
})
