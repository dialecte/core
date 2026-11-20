import { exportDocument } from './export-document'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { runTestCases } from '@/test'

import type { DocumentRecord, ProjectExportParams, ProjectState } from '../types'
import type { ExportFileParams, Store } from '@/store/store.types'
import type { BaseTestCase } from '@/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

const FORMATTED =
	'<?xml version="1.0" encoding="UTF-8"?>\r\n<Root xmlns="urn:r">\r\n    <A a="1"/>\r\n</Root>'
const COMPACT = '<?xml version="1.0" encoding="UTF-8"?><Root xmlns="urn:r"><A a="1"/></Root>'

/** A store whose export answers the formatted or compact bytes; `calls` keeps every call in order. */
function exportingStore(params: {
	calls: string[]
}): Store & { exportFile: ReturnType<typeof vi.fn> } {
	const { calls } = params
	return {
		exportFile: vi.fn(async function exportFile(exportParams: ExportFileParams) {
			const indent = exportParams.options?.indent ?? true
			const ids = exportParams.options?.withDatabaseIds ? ':ids' : ''
			calls.push(`export:${indent ? 'formatted' : 'compact'}${ids}`)
			return {
				file: new Blob([indent ? FORMATTED : COMPACT], { type: 'application/xml' }),
				filename: 'plant.scd',
			}
		}),
	} as unknown as Store & { exportFile: ReturnType<typeof vi.fn> }
}

function makeDocument(): DocumentRecord {
	return {
		id: 'doc-1',
		name: 'plant',
		extension: '.scd',
		configKey: 'default',
		createdAt: 0,
		status: 'ready',
	}
}

function stateOf(document: DocumentRecord): ProjectState {
	return {
		documents: new Map([
			[
				document.id,
				{
					record: document,
					loading: false,
					error: null,
					progress: null,
					history: [],
					lastUpdate: null,
					canUndo: false,
					canRedo: false,
				},
			],
		]),
		activeTransactions: 0,
	}
}

/**
 * A save dialog: `showSaveFilePicker` answers a handle whose writable keeps what is written; `calls` gets
 * `picker` when it opens. `outcome` makes it cancelled by the user or failing.
 */
function stubSaveDialog(params: {
	calls: string[]
	outcome?: 'cancelled' | 'lapsed' | 'failing'
}): {
	saved: () => Blob | undefined
	picker: ReturnType<typeof vi.fn>
} {
	const { calls, outcome } = params
	let written: Blob | undefined
	const picker = vi.fn(async function showSaveFilePicker() {
		calls.push('picker')
		if (outcome === 'cancelled') throw new DOMException('cancelled', 'AbortError')
		if (outcome === 'lapsed') throw new DOMException('no gesture', 'SecurityError')
		if (outcome === 'failing') throw new TypeError('no gesture')
		return {
			createWritable: async () => ({
				write: async (data: Blob) => {
					written = data
				},
				close: async () => {},
			}),
		}
	})
	;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker
	return { saved: () => written, picker }
}

async function runExportDocument(params: {
	store: Store
	options: Omit<ProjectExportParams, 'documentId'>
}) {
	const { store, options } = params
	const document = makeDocument()
	return exportDocument({
		store,
		state: stateOf(document),
		projectName: 'project',
		request: { documentId: document.id, ...options },
	})
}

// ── Test Cases ───────────────────────────────────────────────────────────────

describe('exportDocument', () => {
	afterEach(() => {
		delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
		vi.restoreAllMocks()
	})

	describe("answers the store's file, and what the options ask on top of it", () => {
		type OptionsCase = BaseTestCase & {
			options: Omit<ProjectExportParams, 'documentId'>
			expectedCalls: string[]
			expectedFile: string
			expectedDocument: boolean
			expectedSaved?: string
		}

		const testCases: Record<string, OptionsCase> = {
			'no option -> one formatted export, its file': {
				options: {},
				expectedCalls: ['export:formatted'],
				expectedFile: FORMATTED,
				expectedDocument: false,
			},
			'indent false -> one compact export, its file': {
				options: { indent: false },
				expectedCalls: ['export:compact'],
				expectedFile: COMPACT,
				expectedDocument: false,
			},
			'the DOM with indent false -> one compact export, parsed': {
				options: { indent: false, xmlDocument: true },
				expectedCalls: ['export:compact'],
				expectedFile: COMPACT,
				expectedDocument: true,
			},
			'the DOM with the formatted file -> a second, compact export for the DOM': {
				options: { xmlDocument: true },
				expectedCalls: ['export:formatted', 'export:compact'],
				expectedFile: FORMATTED,
				expectedDocument: true,
			},
			'a download -> the dialog opened before the export, the formatted file saved': {
				options: { download: true },
				expectedCalls: ['picker', 'export:formatted'],
				expectedFile: FORMATTED,
				expectedDocument: false,
				expectedSaved: FORMATTED,
			},
			'the DOM with database ids and the formatted file -> both exports with the ids': {
				options: { xmlDocument: true, withDatabaseIds: true },
				expectedCalls: ['export:formatted:ids', 'export:compact:ids'],
				expectedFile: FORMATTED,
				expectedDocument: true,
			},
			'a download of a compact file with database ids -> both exports with the ids': {
				options: { indent: false, download: true, withDatabaseIds: true },
				expectedCalls: ['picker', 'export:compact:ids', 'export:formatted:ids'],
				expectedFile: COMPACT,
				expectedDocument: false,
				expectedSaved: FORMATTED,
			},
			'a download and the DOM -> the formatted file saved, a compact export for the DOM, two in all':
				{
					options: { download: true, xmlDocument: true },
					expectedCalls: ['picker', 'export:formatted', 'export:compact'],
					expectedFile: FORMATTED,
					expectedDocument: true,
					expectedSaved: FORMATTED,
				},
			'a download and the DOM of a compact file -> a formatted export saved, two in all': {
				options: { indent: false, download: true, xmlDocument: true },
				expectedCalls: ['picker', 'export:compact', 'export:formatted'],
				expectedFile: COMPACT,
				expectedDocument: true,
				expectedSaved: FORMATTED,
			},
			'a download of a compact file -> a second, formatted export saved': {
				options: { indent: false, download: true },
				expectedCalls: ['picker', 'export:compact', 'export:formatted'],
				expectedFile: COMPACT,
				expectedDocument: false,
				expectedSaved: FORMATTED,
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const calls: string[] = []
			const dialog = stubSaveDialog({ calls })
			const store = exportingStore({ calls })
			const result = await runExportDocument({ store, options: testCase.options })

			expect(calls).toEqual(testCase.expectedCalls)
			const text = await result.file.text()
			expect(text).toBe(testCase.expectedFile)
			expect(result.filename).toBe('plant.scd')
			expect('xmlDocument' in result).toBe(testCase.expectedDocument)
			if (testCase.expectedDocument) {
				expect(new XMLSerializer().serializeToString(result.xmlDocument!.documentElement)).toBe(
					COMPACT.replace('<?xml version="1.0" encoding="UTF-8"?>', ''),
				)
			}
			const savedText = await dialog.saved()?.text()
			expect(savedText).toBe(testCase.expectedSaved)
		})
	})

	it('a document not in the project -> DOCUMENT_NOT_REGISTERED', async () => {
		const thrown = await exportDocument({
			store: exportingStore({ calls: [] }),
			state: { documents: new Map(), activeTransactions: 0 },
			projectName: 'project',
			request: { documentId: 'unknown' },
		}).catch((error: unknown) => error)
		expect(toDialecteError(thrown)?.key).toBe('DOCUMENT_NOT_REGISTERED')
	})
})
