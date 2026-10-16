import { IMPORT_HEARTBEAT_MS } from '../state/document-lifecycle'
import { importDocument } from './import-document'

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { runTestCases, TEST_DIALECTE_CONFIG } from '@/test'

import type { Diagnostic } from '@/diagnostics'
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
		updateDocument: vi.fn(),
		removeDocument: vi.fn(),
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

			expect(store.registerDocument).toHaveBeenCalledWith({ ...result.record, status: 'importing' })
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

	describe('a document is whole or absent', () => {
		it('parse succeeds → registered as importing, marked ready once every record is stored', async () => {
			const store = mockStore()
			const file = new File(['<Root/>'], 'test.xml', { type: 'text/xml' })

			const result = await importDocument({ file, store, configs, defaultConfigKey: 'default' })

			expect(store.registerDocument).toHaveBeenCalledWith(
				expect.objectContaining({
					id: result.documentId,
					status: 'importing',
					importingAt: expect.any(Number),
				}),
			)
			expect(store.updateDocument).toHaveBeenCalledWith(result.documentId, { status: 'ready' })
			// ready is set once the parse is done, not before
			const parsedAt = mockParseXmlFile.mock.invocationCallOrder[0]!
			const readyAt = vi.mocked(store.updateDocument).mock.invocationCallOrder.at(-1)!
			expect(readyAt).toBeGreaterThan(parsedAt)
			expect(result.record.status).toBe('ready')
			expect(result.documentState.record.status).toBe('ready')
			expect(store.removeDocument).not.toHaveBeenCalled()
		})

		it('parse fails → the document is removed from the store, the failure is thrown', async () => {
			const failure = new Error('XML parsing error: Unexpected close tag')
			mockParseXmlFile.mockRejectedValue(failure)
			const store = mockStore()
			const file = new File(['<Root>'], 'broken.xml', { type: 'text/xml' })

			await expect(
				importDocument({ file, store, configs, defaultConfigKey: 'default' }),
			).rejects.toBe(failure)

			const registered = vi.mocked(store.registerDocument).mock.calls[0]![0]
			expect(store.removeDocument).toHaveBeenCalledWith(registered.id)
			expect(store.updateDocument).not.toHaveBeenCalled()
		})

		it('a long parse → the document says it is alive every IMPORT_HEARTBEAT_MS, until it is ready', async () => {
			vi.useFakeTimers()
			try {
				mockParseXmlFile.mockImplementation(
					() =>
						new Promise((resolve) =>
							setTimeout(
								() => resolve({ documentId: 'ignored', recordCount: 1, diagnostics: [] }),
								IMPORT_HEARTBEAT_MS * 3 + 100,
							),
						),
				)
				const store = mockStore()
				const file = new File(['<Root/>'], 'big.xml', { type: 'text/xml' })

				const importing = importDocument({ file, store, configs, defaultConfigKey: 'default' })
				await vi.advanceTimersByTimeAsync(IMPORT_HEARTBEAT_MS * 3 + 200)
				const { documentId } = await importing

				const updates = vi.mocked(store.updateDocument).mock.calls.map(([, update]) => update)
				expect(updates.slice(0, 3)).toEqual([
					{ importingAt: expect.any(Number) },
					{ importingAt: expect.any(Number) },
					{ importingAt: expect.any(Number) },
				])
				expect(updates.at(-1)).toEqual({ status: 'ready' })
				expect(vi.mocked(store.updateDocument).mock.calls.every(([id]) => id === documentId)).toBe(
					true,
				)

				// no heartbeat once the import is done
				await vi.advanceTimersByTimeAsync(IMPORT_HEARTBEAT_MS * 2)
				expect(vi.mocked(store.updateDocument).mock.calls.length).toBe(updates.length)
			} finally {
				vi.useRealTimers()
			}
		})

		it('parse fails and the removal fails too → the parse failure is the one thrown', async () => {
			const failure = new Error('XML parsing error')
			mockParseXmlFile.mockRejectedValue(failure)
			const store = mockStore()
			vi.mocked(store.removeDocument).mockRejectedValue(new Error('store closed'))
			const file = new File(['<Root>'], 'broken.xml', { type: 'text/xml' })

			await expect(
				importDocument({ file, store, configs, defaultConfigKey: 'default' }),
			).rejects.toBe(failure)
		})
	})

	describe('import diagnostics', () => {
		it('the parse reports diagnostics → they come out with the document, the parse got the configKey', async () => {
			const unresolved: Diagnostic = {
				code: 'unresolved-reference',
				severity: 'warning',
				source: 'test',
				message: 'A reference names an element the file does not hold',
				ref: { tagName: 'A', id: 'a-1' },
			}
			mockParseXmlFile.mockResolvedValue({
				documentId: 'ignored',
				recordCount: 1,
				diagnostics: [unresolved],
			})
			const store = mockStore()
			const file = new File(['<Root/>'], 'test.xml', { type: 'text/xml' })

			const result = await importDocument({ file, store, configs, defaultConfigKey: 'default' })

			expect(result.diagnostics).toEqual([unresolved])
			expect(mockParseXmlFile).toHaveBeenCalledWith(
				expect.objectContaining({ configKey: 'default' }),
			)
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
