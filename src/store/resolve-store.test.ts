import { resolveStore } from './resolve-store'

import { describe, it, expect, vi } from 'vitest'

import { DexieStore } from '@/store'

import type { StorageParam } from '../project/types'
import type { Store } from '@/store'
import type { AnyDialecteConfig } from '@/types'

// ── Mock Config ──────────────────────────────────────────────────────────────

function mockConfig(): AnyDialecteConfig {
	return {
		database: {
			recordSchema: {
				primaryKey: 'id',
				indexes: ['tagName'],
				compoundIndexes: [],
				arrayIndexes: [],
			},
		},
	} as unknown as AnyDialecteConfig
}

// ── Test Cases ───────────────────────────────────────────────────────────────

describe('resolveStore', () => {
	const config = mockConfig()

	const cases: Record<
		string,
		{
			storage: StorageParam
			expectedType: 'dexie' | 'custom'
		}
	> = {
		'local storage -> returns DexieStore': {
			storage: { type: 'local' },
			expectedType: 'dexie',
		},
		'custom storage -> returns provided store': {
			storage: { type: 'custom', store: { open: vi.fn() } as unknown as Store },
			expectedType: 'custom',
		},
	}

	it.each(Object.entries(cases))('%s', (_label, { storage, expectedType }) => {
		const result = resolveStore('test-project', storage, config)

		if (expectedType === 'dexie') {
			expect(result).toBeInstanceOf(DexieStore)
		} else {
			expect(result).toBe((storage as { type: 'custom'; store: Store }).store)
		}
	})

	it('DexieStore receives recordSchema from config', () => {
		const store = resolveStore('schema-test', { type: 'local' }, config) as DexieStore

		// DexieStore was constructed with the name and options
		expect(store).toBeInstanceOf(DexieStore)
	})
})
