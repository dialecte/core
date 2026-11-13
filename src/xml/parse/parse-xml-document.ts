import { ParseSession } from './parse-session'
import { DEFAULT_BATCH_SIZE, DEFAULT_CHUNK_SIZE } from './parse-xml-document.constants'
import { setSaxParser } from './parser'

import { throwDialecteError, toDialecteError } from '@/errors'
import { assertXmlCharacters } from '@/helpers/assert-xml-characters'
import { NOOP_PERF } from '@/perf'
import { readableExtensionsOf } from '@/store/document-path'
import { createImportReporter } from '@/store/import-progress/import-progress'
import {
	IMPORT_CHECK_CHUNK_SIZE,
	IMPORT_PROCESSING_START_STEP,
} from '@/store/import-progress/import-progress.constants'
import { checkJsonValues } from '@/store/json-values'
import { invariant } from '@/utils'

import type {
	ParseTarget,
	ParseXmlFileParams,
	ParseXmlFileResult,
} from './parse-xml-document.types'
import type { Diagnostic } from '@/diagnostics'
import type { Perf } from '@/perf'
import type { ImportReporter } from '@/store/import-progress/import-progress.types'
import type { ImportControl, ImportStepReport } from '@/store/store.types'
import type { AfterImportContext, AnyRawRecord, ImportSession, RecordPatch } from '@/types'

export type { ParseXmlFileParams, ParseXmlFileResult } from './parse-xml-document.types'

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Parse a single XML file and persist records into a Store via chunked streaming.
 *
 * - Uses SAX streaming to avoid loading full XML into memory
 * - Batches records and flushes to Store.bulkWrite in chunks
 * - ParseSession encapsulates parent-child resolution state (no module globals)
 * - Database-agnostic: only calls its target's bulkWrite (the file's records) and writeSession (the session's)
 * - `control`: progress told after each stored batch, then `processing` (core's `start`, then the steps the
 *   session reports), `checking` and `applying` (never awaited; through `params.reporter` when given, which the
 *   caller closes); an abort honoured before each batch, between the session's steps, before its checks and
 *   before its writes (`IMPORT_ABORTED`; the records already stored are the caller's to remove)
 *
 * @internal the streaming parser `runImport` drives; callers import through the project
 */
export async function parseXmlFile(
	params: ParseXmlFileParams,
	control: ImportControl = {},
): Promise<ParseXmlFileResult> {
	const { file, perf = NOOP_PERF } = params
	// a reporter of its own when the caller gives none: closed with the parse
	const ownReporter = params.reporter
		? undefined
		: createImportReporter({ totalBytes: file.size, listener: control.onProgress, perf })
	const reporter = params.reporter ?? ownReporter!
	try {
		return await parseWithReporter({ ...params, reporter }, control)
	} finally {
		ownReporter?.close()
	}
}

/** The parse of a non-empty file of a supported type, its progress told through `reporter`. */
async function parseWithReporter(
	params: ParseXmlFileParams & { reporter: ImportReporter },
	control: ImportControl,
): Promise<ParseXmlFileResult> {
	const {
		documentId,
		configKey,
		store,
		config,
		useCustomRecordsIds = false,
		chunkOptions,
		hooks,
		perf = NOOP_PERF,
		reporter,
	} = params
	let { file } = params

	const readableExtensions = readableExtensionsOf({ extensions: config.io.supportedFileExtensions })

	invariant(
		readableExtensions.some((extension) => file.name.toLowerCase().endsWith(extension)),
		{ key: 'ASSERTION_FAILED', detail: `Unsupported file type: ${file.name}` },
	)

	if (file.size === 0) {
		return { documentId, recordCount: 0, diagnostics: [] }
	}

	const beforeImport = hooks?.beforeImport
	if (beforeImport) {
		const rawXml = await file.text()
		const transformed = beforeImport(rawXml)
		file = new File([transformed], file.name, { type: file.type })
	}

	const chunkSize = chunkOptions?.chunkSize ?? DEFAULT_CHUNK_SIZE
	const batchSize = chunkOptions?.batchSize ?? DEFAULT_BATCH_SIZE

	const session = new ParseSession()
	// One session per file: its state is this file's only, and it is dropped after afterImport.
	const importSession = hooks?.createImportSession?.({ documentId, configKey })
	const sax = setSaxParser({
		dialecteConfig: config,
		useCustomRecordsIds,
		session,
		hooks,
		importSession,
		perf,
	})

	const parsedCount = await streamFileInChunks({
		file,
		sax,
		session,
		store,
		documentId,
		chunkSize,
		batchSize,
		perf,
		control,
		reporter,
	})

	const { recordDelta, diagnostics } = await endImportSession({
		importSession,
		store,
		documentId,
		file,
		perf,
		signal: control.signal,
		reporter,
	})

	return { documentId, recordCount: parsedCount + recordDelta, diagnostics }
}

// ── Stream processing ────────────────────────────────────────────────────────

async function streamFileInChunks(params: {
	file: File
	sax: ReturnType<typeof setSaxParser>
	session: ParseSession
	store: ParseTarget
	documentId: string
	chunkSize: number
	batchSize: number
	perf: Perf
	control: ImportControl
	reporter: ImportReporter
}): Promise<number> {
	const { file, sax, session, store, documentId, chunkSize, batchSize, perf, control, reporter } =
		params

	const batchParams = { sax, session, store, documentId, file, perf, control, reporter }
	let totalRecords = 0
	// The bytes fed to the parser so far: what progress tells, the file's size once all is parsed.
	let bytesRead = 0
	const reader = file.stream().getReader()
	const textDecoder = new TextDecoder()
	// Bytes left over from the previous read (< chunkSize, or a split multi-byte char):
	// carried and re-fed at the head of the next read so every byte is decoded once, in order.
	let remainder = new Uint8Array(0)

	let done = false
	while (!done) {
		const result = await reader.read()
		done = result.done

		if (result.value) {
			const buffer = remainder.length === 0 ? result.value : appendToBuffer(remainder, result.value)

			// Advance a cursor with subarray VIEWS (O(1), no copy) instead of re-slicing the
			// tail every chunk (the old `buffer = buffer.slice(chunkSize)` was O(fileSize²)).
			let offset = 0
			while (offset + chunkSize <= buffer.length) {
				const chunk = perf.time('import::decode', () =>
					textDecoder.decode(buffer.subarray(offset, offset + chunkSize), { stream: true }),
				)
				offset += chunkSize
				bytesRead += chunkSize
				perf.time('import::parse', () => sax.parser.write(chunk))

				totalRecords += await flushBatch({
					...batchParams,
					threshold: batchSize,
					bytesRead,
				})
			}
			// Copy the small tail into a fresh array so the (possibly huge) read buffer is released.
			remainder = offset < buffer.length ? buffer.slice(offset) : new Uint8Array(0)
		}

		if (done) {
			if (remainder.length > 0) {
				// final flush of any pending multi-byte char
				const tail = perf.time('import::decode', () => textDecoder.decode(remainder))
				bytesRead += remainder.length
				perf.time('import::parse', () => sax.parser.write(tail))
			}
			perf.time('import::parse', () => sax.parser.close())
			totalRecords += await flushBatch({
				...batchParams,
				threshold: 0,
				bytesRead,
			})
		}
	}

	return totalRecords
}

// ── End of the import session ────────────────────────────────────────────────

async function endImportSession(params: {
	importSession?: ImportSession
	store: ParseTarget
	documentId: string
	file: File
	perf: Perf
	signal?: AbortSignal
	reporter: ImportReporter
}): Promise<{ recordDelta: number; diagnostics: Diagnostic[] }> {
	const { importSession, store, documentId, file, perf, reporter } = params
	// the hook always holds a signal: one that never aborts when the caller gave none
	const signal = params.signal ?? new AbortController().signal

	throwIfAborted({ signal, file })
	reporter.tell({ phase: 'processing', step: IMPORT_PROCESSING_START_STEP })
	if (!importSession?.afterImport) return { recordDelta: 0, diagnostics: [] }

	const result = await runAfterImport({
		afterImport: importSession.afterImport,
		file,
		perf,
		signal,
		reporter,
	})
	const { creates, updates, deletes, diagnostics = [] } = result
	throwIfAborted({ signal, file })
	checkSession({ diagnostics, creates, updates, reporter })
	const total = (creates?.length ?? 0) + (updates?.length ?? 0) + (deletes?.length ?? 0)
	if (total > 0) {
		throwIfAborted({ signal, file })
		reporter.tell({ phase: 'applying', done: 0, total })
		perf.start('import::writes.after')
		try {
			await store.writeSession(
				documentId,
				{ creates, updates, deletes },
				{
					onProgress: function tellApplied(applied) {
						reporter.tell({ phase: 'applying', ...applied })
					},
				},
			)
		} finally {
			perf.stop('import::writes.after')
		}
		reporter.tell({ phase: 'applying', done: total, total })
	}

	return { recordDelta: (creates?.length ?? 0) - (deletes?.length ?? 0), diagnostics }
}

/**
 * The session's `afterImport`, handed where it reports its steps and the import's abort: a step reported once the
 * import is aborted is not told, and whatever the hook throws on an abort is the abort (`IMPORT_ABORTED`).
 */
async function runAfterImport(params: {
	afterImport: NonNullable<ImportSession['afterImport']>
	file: File
	perf: Perf
	signal: AbortSignal
	reporter: ImportReporter
}): Promise<Awaited<ReturnType<NonNullable<ImportSession['afterImport']>>>> {
	const { afterImport, file, perf, signal, reporter } = params
	const context: AfterImportContext = {
		report: function reportStep(step) {
			if (signal.aborted) return
			reporter.tell({ phase: 'processing', ...stepFieldsOf({ step }) })
		},
		signal,
	}
	perf.start('import::hooks.after')
	try {
		return await afterImport(context)
	} catch (thrown) {
		throwIfAborted({ signal, file })
		throw thrown
	} finally {
		perf.stop('import::hooks.after')
	}
}

/**
 * What a step the session reports is told with: its name, and its count when it gives numbers - taken field by
 * field, so a hook written without types can neither change the phase nor hand the listener a value that does not
 * cross to another realm.
 */
function stepFieldsOf(params: { step: ImportStepReport }): ImportStepReport {
	const { step, done, total } = params.step
	return {
		step: String(step),
		...(typeof done === 'number' && { done }),
		...(typeof total === 'number' && { total }),
	}
}

/**
 * The session's diagnostics, then its creates and updates, checked a chunk at a time, `checking` told before and
 * after each chunk; checked before its writes, so a refused import has written none of them.
 */
function checkSession(params: {
	diagnostics: Diagnostic[]
	creates?: readonly AnyRawRecord[]
	updates?: readonly RecordPatch[]
	reporter: ImportReporter
}): void {
	const { diagnostics, creates = [], updates = [], reporter } = params
	const total = diagnostics.length + creates.length + updates.length
	let done = 0
	reporter.tell({ phase: 'checking', done, total })
	for (let start = 0; start < diagnostics.length; start += IMPORT_CHECK_CHUNK_SIZE) {
		const chunk = diagnostics.slice(start, start + IMPORT_CHECK_CHUNK_SIZE)
		checkSessionDiagnostics({ diagnostics: chunk, offset: start })
		done += chunk.length
		reporter.tell({ phase: 'checking', done, total })
	}
	for (let start = 0; start < creates.length; start += IMPORT_CHECK_CHUNK_SIZE) {
		const chunk = creates.slice(start, start + IMPORT_CHECK_CHUNK_SIZE)
		checkSessionWrites({ creates: chunk })
		done += chunk.length
		reporter.tell({ phase: 'checking', done, total })
	}
	for (let start = 0; start < updates.length; start += IMPORT_CHECK_CHUNK_SIZE) {
		const chunk = updates.slice(start, start + IMPORT_CHECK_CHUNK_SIZE)
		checkSessionWrites({ updates: chunk })
		done += chunk.length
		reporter.tell({ phase: 'checking', done, total })
	}
}

/**
 * What the session says is answered by every store alike, through a port too: plain JSON only, a refusal naming
 * the chunk it was found in (`offset`, its first diagnostic among all of them). Checked
 * before its writes, so a refused import has written none of them.
 */
function checkSessionDiagnostics(params: { diagnostics: Diagnostic[]; offset: number }): void {
	const { diagnostics, offset } = params
	try {
		checkJsonValues({ value: diagnostics })
	} catch (thrown) {
		const among = `among the diagnostics ${offset}-${offset + diagnostics.length - 1}`
		throwDialecteError('STORE_VALUE_NOT_JSON', {
			detail: `A diagnostic of the import session: ${toDialecteError(thrown)?.detail ?? String(thrown)} (${among})`,
			cause: thrown instanceof Error ? thrown : undefined,
		})
	}
}

/**
 * What the session writes holds XML characters only, as a transaction's writes (`XML_CHARACTER_NOT_ALLOWED`).
 * Checked before its writes, so a refused import has written none of them.
 */
function checkSessionWrites(params: {
	creates?: readonly AnyRawRecord[]
	updates?: readonly RecordPatch[]
}): void {
	const { creates = [], updates = [] } = params
	for (const record of creates) assertXmlCharacters({ record })
	for (const patch of updates) assertXmlCharacters({ record: { ...patch, id: patch.recordId } })
}

/** An aborted import goes no further: `IMPORT_ABORTED`. */
export function throwIfAborted(params: { signal?: AbortSignal; file: File }): void {
	const { signal, file } = params
	if (!signal?.aborted) return
	throwDialecteError('IMPORT_ABORTED', {
		detail: `The import of "${file.name}" was aborted`,
		meta: { fileName: file.name },
	})
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function appendToBuffer(existing: Uint8Array, incoming: Uint8Array<ArrayBufferLike>): Uint8Array {
	const merged = new Uint8Array(existing.length + incoming.length)
	merged.set(existing)
	merged.set(incoming, existing.length)
	return merged
}

/** Store the records parsed so far once there are `threshold` of them, then tell the bytes parsed. */
async function flushBatch(params: {
	sax: ReturnType<typeof setSaxParser>
	session: ParseSession
	store: ParseTarget
	documentId: string
	file: File
	threshold: number
	perf: Perf
	control: ImportControl
	reporter: ImportReporter
	/** The bytes of the file parsed so far: what the progress tells */
	bytesRead: number
}): Promise<number> {
	const { sax, session, store, documentId, file, threshold, perf, control, reporter, bytesRead } =
		params

	if (sax.getSize() < threshold) return 0
	throwIfAborted({ signal: control.signal, file })

	perf.start('import::insert')
	let stored: number
	try {
		const resolved = session.resolveChildrenForBatch(sax.drainBatch())
		await store.bulkWrite(documentId, { creates: resolved })
		stored = resolved.length
	} finally {
		perf.stop('import::insert')
	}
	reporter.tell({ phase: 'storing', bytesRead })
	return stored
}
