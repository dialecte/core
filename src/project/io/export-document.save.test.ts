import { exportDocument } from './export-document'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runTestCases } from '@/test'

import type { DocumentRecord, ProjectExportParams, ProjectState } from '../types'
import type { ExportFileParams, Store } from '@/store/store.types'
import type { BaseTestCase } from '@/test'
import type { SaveOutcome, SaveTarget } from '@/utils/save-to-disk.types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const FORMATTED =
	'<?xml version="1.0" encoding="UTF-8"?>\r\n<Root xmlns="urn:r">\r\n    <A a="1"/>\r\n</Root>'
const COMPACT = '<?xml version="1.0" encoding="UTF-8"?><Root xmlns="urn:r"><A a="1"/></Root>'

/** A store whose export answers the formatted or compact bytes, or throws `failing`; `calls` keeps every call in order. */
function exportingStore(params: {
	calls: string[]
	failing?: Error
}): Store & { exportFile: ReturnType<typeof vi.fn> } {
	const { calls, failing } = params
	return {
		exportFile: vi.fn(async function exportFile(exportParams: ExportFileParams) {
			if (failing) throw failing
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
	failWrite?: Error
}): {
	saved: () => Blob | undefined
	removed: () => boolean
	picker: ReturnType<typeof vi.fn>
} {
	const { calls, outcome, failWrite } = params
	let written: Blob | undefined
	let removed = false
	const picker = vi.fn(async function showSaveFilePicker() {
		calls.push('picker')
		if (outcome === 'cancelled') throw new DOMException('cancelled', 'AbortError')
		if (outcome === 'lapsed') throw new DOMException('no gesture', 'SecurityError')
		if (outcome === 'failing') throw new TypeError('no gesture')
		return {
			getFile: async () => new File([], 'plant.scd'),
			createWritable: async () => ({
				abort: async () => {},
				write: async (data: Blob) => {
					if (failWrite) throw failWrite
					written = data
				},
				close: async () => {},
			}),
			remove: async () => {
				removed = true
			},
		}
	})
	;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker
	return { saved: () => written, removed: () => removed, picker }
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

/** A save target its caller opened before the export, with that outcome; `written` gets what it was given, `discarded` whether it was discarded. */
function fakeTarget(params: { outcome?: SaveOutcome; failWrite?: Error }): {
	target: SaveTarget
	written: () => Blob | undefined
	discarded: () => boolean
} {
	const { outcome = 'written' } = params
	let written: Blob | undefined
	let discarded = false
	async function discard() {
		discarded = true
	}
	const target: SaveTarget =
		outcome === 'cancelled'
			? { outcome, discard }
			: {
					outcome,
					write: async (data: Blob) => {
						if (params.failWrite) throw params.failWrite
						written = data
					},
					discard,
				}
	return { target, written: () => written, discarded: () => discarded }
}

/** A browser download through a hidden anchor: whether one was made. */
function stubDownload(): () => boolean {
	let downloaded = false
	const anchor = document.createElement('a')
	anchor.click = () => {
		downloaded = true
	}
	vi.spyOn(document, 'createElement').mockReturnValue(anchor)
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download')
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
	return () => downloaded
}

// ── Test Cases ───────────────────────────────────────────────────────────────

describe('exportDocument', () => {
	afterEach(() => {
		delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
		vi.restoreAllMocks()
	})

	describe('the save dialog', () => {
		it("a download -> the dialog suggests the document filename, its extension's type", async () => {
			const calls: string[] = []
			const dialog = stubSaveDialog({ calls })
			await runExportDocument({ store: exportingStore({ calls }), options: { download: true } })
			expect(dialog.picker).toHaveBeenCalledWith({
				suggestedName: 'plant.scd',
				types: [{ description: 'SCD Files', accept: { 'application/xml': ['.scd'] } }],
			})
		})

		it("a download under another filename -> that name, the document extension's type", async () => {
			const calls: string[] = []
			const dialog = stubSaveDialog({ calls })
			await runExportDocument({
				store: exportingStore({ calls }),
				options: { download: { filename: 'copy.xml' } },
			})
			expect(dialog.picker).toHaveBeenCalledWith({
				suggestedName: 'copy.xml',
				types: [{ description: 'SCD Files', accept: { 'application/xml': ['.scd'] } }],
			})
		})

		describe('answers where the file went, the file answered in every case', () => {
			type SavedCase = BaseTestCase & {
				dialog?: 'cancelled' | 'lapsed'
				download?: ProjectExportParams['download'] | 'a target'
				target?: SaveOutcome
				indent?: boolean
				expectedCalls: string[]
				expectedSaved: SaveOutcome | 'not answered'
				expectedWrittenTo: 'dialog' | 'download' | 'target' | 'nowhere'
			}
			const testCases: Record<string, SavedCase> = {
				'no download -> no saved answered, nothing written': {
					expectedCalls: ['export:formatted'],
					expectedSaved: 'not answered',
					expectedWrittenTo: 'nowhere',
				},
				'the dialog accepted -> written, to the file chosen': {
					download: true,
					expectedCalls: ['picker', 'export:formatted'],
					expectedSaved: 'written',
					expectedWrittenTo: 'dialog',
				},
				'the dialog refused for a lapsed gesture -> downloaded': {
					dialog: 'lapsed',
					download: true,
					expectedCalls: ['picker', 'export:formatted'],
					expectedSaved: 'downloaded',
					expectedWrittenTo: 'download',
				},
				'the dialog cancelled -> cancelled, nothing written': {
					dialog: 'cancelled',
					download: true,
					expectedCalls: ['picker', 'export:formatted'],
					expectedSaved: 'cancelled',
					expectedWrittenTo: 'nowhere',
				},
				'a compact file, the dialog cancelled -> no second, formatted export, cancelled': {
					dialog: 'cancelled',
					download: true,
					indent: false,
					expectedCalls: ['picker', 'export:compact'],
					expectedSaved: 'cancelled',
					expectedWrittenTo: 'nowhere',
				},
				'a target opened before, on a file -> no dialog of its own, written to the target': {
					download: 'a target',
					target: 'written',
					expectedCalls: ['export:formatted'],
					expectedSaved: 'written',
					expectedWrittenTo: 'target',
				},
				'a target opened before, a download -> written to the target, downloaded': {
					download: 'a target',
					target: 'downloaded',
					expectedCalls: ['export:formatted'],
					expectedSaved: 'downloaded',
					expectedWrittenTo: 'target',
				},
				'a cancelled target -> no dialog of its own, nothing written, cancelled': {
					download: 'a target',
					target: 'cancelled',
					expectedCalls: ['export:formatted'],
					expectedSaved: 'cancelled',
					expectedWrittenTo: 'nowhere',
				},
			}

			runTestCases.generic(testCases, async (testCase) => {
				const calls: string[] = []
				const dialog = stubSaveDialog({ calls, outcome: testCase.dialog })
				const downloads = stubDownload()
				const target = fakeTarget({ outcome: testCase.target })
				const download =
					testCase.download === 'a target' ? { target: target.target } : testCase.download

				const result = await runExportDocument({
					store: exportingStore({ calls }),
					options: {
						...(download === undefined ? {} : { download }),
						...(testCase.indent === undefined ? {} : { indent: testCase.indent }),
					},
				})

				expect(calls).toEqual(testCase.expectedCalls)
				const text = await result.file.text()
				expect(text).toBe(testCase.indent === false ? COMPACT : FORMATTED)
				expect('saved' in result ? result.saved : 'not answered').toBe(testCase.expectedSaved)
				const writtenTo = [
					dialog.saved() && 'dialog',
					downloads() && 'download',
					target.written() && 'target',
				].filter(Boolean)
				expect(writtenTo).toEqual(
					testCase.expectedWrittenTo === 'nowhere' ? [] : [testCase.expectedWrittenTo],
				)
			})
		})

		it('the dialog refused for a lapsed gesture -> the formatted file downloaded instead', async () => {
			const calls: string[] = []
			stubSaveDialog({ calls, outcome: 'lapsed' })
			const click = vi.fn()
			const anchor = document.createElement('a')
			anchor.click = click
			vi.spyOn(document, 'createElement').mockReturnValue(anchor)
			const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:lapsed')
			vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
			const result = await runExportDocument({
				store: exportingStore({ calls }),
				options: { download: true },
			})
			expect(calls).toEqual(['picker', 'export:formatted'])
			expect(createObjectURL).toHaveBeenCalledWith(result.file)
			expect(anchor.download).toBe('plant.scd')
			expect(click).toHaveBeenCalled()
		})

		describe('an export failing once the save was asked -> the failure thrown, the dialog it opened discarded', () => {
			type FailedCase = BaseTestCase & {
				download: 'the dialog' | 'a filename' | 'a target'
				failing?: 'the write'
				expectedDiscarded: boolean
			}
			const testCases: Record<string, FailedCase> = {
				'the dialog opened for the export -> the file it created removed': {
					download: 'the dialog',
					expectedDiscarded: true,
				},
				'a target the caller opened -> left to the caller, not discarded': {
					download: 'a target',
					expectedDiscarded: false,
				},
				'the dialog opened for another filename -> the file it created removed': {
					download: 'a filename',
					expectedDiscarded: true,
				},
				'the write failing to the dialog opened for the export -> the file left empty removed': {
					download: 'the dialog',
					failing: 'the write',
					expectedDiscarded: true,
				},
				'the write failing to a target the caller opened -> left to the caller, not discarded': {
					download: 'a target',
					failing: 'the write',
					expectedDiscarded: false,
				},
			}

			runTestCases.generic(testCases, async (testCase) => {
				const calls: string[] = []
				const failure = new Error('the export failed')
				const failWrite = testCase.failing === 'the write' ? failure : undefined
				const dialog = stubSaveDialog({ calls, failWrite })
				const target = fakeTarget({ failWrite })
				const download =
					testCase.download === 'a target'
						? { target: target.target }
						: testCase.download === 'a filename'
							? { filename: 'copy.scd' }
							: true

				const exported = runExportDocument({
					store: exportingStore({ calls, failing: failWrite ? undefined : failure }),
					options: { download },
				})

				await expect(exported).rejects.toBe(failure)
				expect(dialog.removed() || target.discarded()).toBe(testCase.expectedDiscarded)
			})
		})

		it('the dialog failing -> the failure thrown, nothing exported', async () => {
			const calls: string[] = []
			stubSaveDialog({ calls, outcome: 'failing' })
			const store = exportingStore({ calls })
			await expect(runExportDocument({ store, options: { download: true } })).rejects.toThrow(
				'no gesture',
			)
			expect(store.exportFile).not.toHaveBeenCalled()
		})
	})
})
