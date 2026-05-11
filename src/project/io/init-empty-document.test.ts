import { initEmptyDocument } from './init-empty-document'

import { describe, it, expect, vi } from 'vitest'

import { runTestCases, TEST_DIALECTE_CONFIG } from '@/test'

import type { InitEmptyDocumentOptions } from '../types'
import type { Store } from '@/store/store.types'
import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig } from '@/types'

// ── Mock Store ───────────────────────────────────────────────────────────────

function mockStore(): Store {
	return {
		registerDocument: vi.fn(),
		bulkWrite: vi.fn(),
	} as unknown as Store
}

// ── Test Cases ───────────────────────────────────────────────────────────────

describe('initEmptyDocument', () => {
	const configs = {
		default: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig,
		alt: {
			...TEST_DIALECTE_CONFIG,
			io: { supportedFileExtensions: ['.alt'] },
		} as unknown as AnyDialecteConfig,
	}

	type TestCase = BaseTestCase & {
		options?: InitEmptyDocumentOptions
		defaultConfigKey: string
		expectedName: string
		expectedExtension: string
		expectedConfigKey: string
	}

	const cases: Record<string, TestCase> = {
		'no options -> defaults from config': {
			options: undefined,
			defaultConfigKey: 'default',
			expectedName: 'untitled',
			expectedExtension: '.xml',
			expectedConfigKey: 'default',
		},
		'custom name + extension': {
			options: { name: 'my-file', extension: '.icd' },
			defaultConfigKey: 'default',
			expectedName: 'my-file',
			expectedExtension: '.icd',
			expectedConfigKey: 'default',
		},
		'explicit configKey overrides default': {
			options: { configKey: 'alt' },
			defaultConfigKey: 'default',
			expectedName: 'untitled',
			expectedExtension: '.alt',
			expectedConfigKey: 'alt',
		},
		'metadata passed through': {
			options: { metadata: { source: 'import' } },
			defaultConfigKey: 'default',
			expectedName: 'untitled',
			expectedExtension: '.xml',
			expectedConfigKey: 'default',
		},
	}

	runTestCases.generic(cases, async (tc) => {
		const store = mockStore()

		const result = await initEmptyDocument({
			store,
			configs,
			defaultConfigKey: tc.defaultConfigKey,
			options: tc.options,
		})

		expect(result.document.name).toBe(tc.expectedName)
		expect(result.document.extension).toBe(tc.expectedExtension)
		expect(result.document.configKey).toBe(tc.expectedConfigKey)
		expect(result.document.id).toBeTruthy()
		expect(result.documentId).toBe(result.document.id)
		expect(result.documentState.document).toBe(result.document)
		expect(store.registerDocument).toHaveBeenCalledWith(result.document)
	})

	it('metadata preserved in DocumentRecord', async () => {
		const store = mockStore()
		const result = await initEmptyDocument({
			store,
			configs,
			defaultConfigKey: 'default',
			options: { metadata: { source: 'import', version: 2 } },
		})

		expect(result.document.metadata).toEqual({ source: 'import', version: 2 })
	})

	it('unknown configKey -> throws UNKNOWN_CONFIG_KEY', async () => {
		const store = mockStore()

		await expect(
			initEmptyDocument({
				store,
				configs,
				defaultConfigKey: 'default',
				options: { configKey: 'nonexistent' },
			}),
		).rejects.toThrow(/Unknown configKey: "nonexistent"/)
	})
})
