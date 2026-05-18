import { importDocument } from './import-document'

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { runTestCases, TEST_DIALECTE_CONFIG } from '@/test'

import type { Store } from '@/store/store.types'
import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig } from '@/types'

// ── Mock parseXmlFile ────────────────────────────────────────────────────────

const mockParseXmlFile = vi.fn()
vi.mock('@/xml', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/xml')>()),
	parseXmlFile: (...args: unknown[]) => mockParseXmlFile(...args),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockStore(): Store {
	return {
		registerDocument: vi.fn(),
	} as unknown as Store
}

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const configs = { default: CONFIG }

// ── Test Cases ───────────────────────────────────────────────────────────────

describe('importDocument', () => {
	beforeEach(() => {
		mockParseXmlFile.mockResolvedValue({ documentId: 'ignored', recordCount: 42 })
	})

	describe('filename extraction', () => {
		type TestCase = BaseTestCase & {
			fileName: string
			expectedName: string
			expectedExtension: string
		}

		const cases: Record<string, TestCase> = {
			'standard .xml file': {
				fileName: 'station.xml',
				expectedName: 'station',
				expectedExtension: '.xml',
			},
			'compound extension .scd': {
				fileName: 'my-project.scd',
				expectedName: 'my-project',
				expectedExtension: '.scd',
			},
			'name with dots': {
				fileName: 'station.v2.3.xml',
				expectedName: 'station.v2.3',
				expectedExtension: '.xml',
			},
			'no extension -> falls back to config default': {
				fileName: 'noext',
				expectedName: 'noext',
				expectedExtension: '.xml',
			},
		}

		runTestCases.generic(cases, async (tc) => {
			const store = mockStore()
			const file = new File(['<Root/>'], tc.fileName, { type: 'text/xml' })

			const result = await importDocument({
				file,
				store,
				configs,
				defaultConfigKey: 'default',
			})

			expect(result.record.name).toBe(tc.expectedName)
			expect(result.record.extension).toBe(tc.expectedExtension)
		})
	})

	describe('document registration', () => {
		it('registers DocumentRecord in store before parsing', async () => {
			const store = mockStore()
			const file = new File(['<Root/>'], 'test.xml', { type: 'text/xml' })

			const result = await importDocument({
				file,
				store,
				configs,
				defaultConfigKey: 'default',
			})

			expect(store.registerDocument).toHaveBeenCalledWith(result.record)
			expect(result.record.configKey).toBe('default')
			expect(result.documentId).toBe(result.record.id)
		})

		it('metadata passed through to DocumentRecord', async () => {
			const store = mockStore()
			const file = new File(['<Root/>'], 'test.xml', { type: 'text/xml' })

			const result = await importDocument({
				file,
				store,
				configs,
				defaultConfigKey: 'default',
				options: { metadata: { source: 'upload', version: 3 } },
			})

			expect(result.record.metadata).toEqual({ source: 'upload', version: 3 })
		})
	})

	describe('configKey resolution', () => {
		const altConfig = {
			...TEST_DIALECTE_CONFIG,
			io: { supportedFileExtensions: ['.alt'] },
		} as unknown as AnyDialecteConfig

		const multiConfigs = { default: CONFIG, alt: altConfig }

		it('explicit configKey overrides default', async () => {
			const store = mockStore()
			const file = new File(['<Root/>'], 'test.xml', { type: 'text/xml' })

			const result = await importDocument({
				file,
				store,
				configs: multiConfigs,
				defaultConfigKey: 'default',
				options: { configKey: 'alt' },
			})

			expect(result.record.configKey).toBe('alt')
		})

		it('unknown configKey -> throws UNKNOWN_CONFIG_KEY', async () => {
			const store = mockStore()
			const file = new File(['<Root/>'], 'test.xml', { type: 'text/xml' })

			await expect(
				importDocument({
					file,
					store,
					configs,
					defaultConfigKey: 'default',
					options: { configKey: 'nonexistent' },
				}),
			).rejects.toThrow(/Unknown configKey: "nonexistent"/)
		})
	})

	describe('parseXmlFile delegation', () => {
		it('passes file, documentId, store, config to parseXmlFile', async () => {
			const store = mockStore()
			const file = new File(['<Root/>'], 'test.xml', { type: 'text/xml' })

			const result = await importDocument({
				file,
				store,
				configs,
				defaultConfigKey: 'default',
			})

			expect(mockParseXmlFile).toHaveBeenCalledWith(
				expect.objectContaining({
					file,
					documentId: result.documentId,
					store,
					config: CONFIG,
				}),
			)
		})

		it('forwards chunkOptions and useCustomRecordsIds', async () => {
			const store = mockStore()
			const file = new File(['<Root/>'], 'test.xml', { type: 'text/xml' })

			await importDocument({
				file,
				store,
				configs,
				defaultConfigKey: 'default',
				options: {
					useCustomRecordsIds: true,
					chunkOptions: { batchSize: 100, chunkSize: 1024 },
				},
			})

			expect(mockParseXmlFile).toHaveBeenCalledWith(
				expect.objectContaining({
					useCustomRecordsIds: true,
					chunkOptions: { batchSize: 100, chunkSize: 1024 },
				}),
			)
		})

		it('returns recordCount from parseXmlFile', async () => {
			mockParseXmlFile.mockResolvedValue({ documentId: 'x', recordCount: 99 })
			const store = mockStore()
			const file = new File(['<Root/>'], 'test.xml', { type: 'text/xml' })

			const result = await importDocument({
				file,
				store,
				configs,
				defaultConfigKey: 'default',
			})

			expect(result.recordCount).toBe(99)
		})
	})

	it('returns valid documentState', async () => {
		const store = mockStore()
		const file = new File(['<Root/>'], 'test.xml', { type: 'text/xml' })

		const result = await importDocument({
			file,
			store,
			configs,
			defaultConfigKey: 'default',
		})

		expect(result.documentState.record).toBe(result.record)
		expect(result.documentState.loading).toBe(false)
		expect(result.documentState.lastUpdate).toBeNull()
	})
})
