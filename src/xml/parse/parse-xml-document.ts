import { ParseSession } from './parse-session'
import { DEFAULT_BATCH_SIZE, DEFAULT_CHUNK_SIZE } from './parse-xml-document.constants'
import { setSaxParser } from './parser'

import { throwDialecteError } from '@/errors'
import { NOOP_PERF } from '@/perf'
import { invariant } from '@/utils'
import { tellListener } from '@/utils/tell-listener'

import type { ParseXmlFileParams, ParseXmlFileResult } from './parse-xml-document.types'
import type { Diagnostic } from '@/diagnostics'
import type { Perf } from '@/perf'
import type { ImportControl, ImportProgress, ImportTarget } from '@/store/store.types'
import type { ImportSession } from '@/types'

export type { ParseXmlFileParams, ParseXmlFileResult } from './parse-xml-document.types'

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Parse a single XML file and persist records into a Store via chunked streaming.
 *
 * - Uses SAX streaming to avoid loading full XML into memory
 * - Batches records and flushes to Store.bulkWrite in chunks
 * - ParseSession encapsulates parent-child resolution state (no module globals)
 * - Database-agnostic: only calls Store.bulkWrite(documentId, ops)
 * - `control`: progress told after each stored batch (never awaited), an abort honoured before each
 *   batch and before the session's writes (`IMPORT_ABORTED`; the records already stored are the
 *   caller's to remove)
 */
export async function parseXmlFile(
	params: ParseXmlFileParams,
	control: ImportControl = {},
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
	} = params
	let { file } = params

	const { supportedFileExtensions } = config.io

	invariant(
		supportedFileExtensions.some((ext) => file.name.toLowerCase().endsWith(ext)),
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
	})

	const { recordDelta, diagnostics } = await endImportSession({
		importSession,
		store,
		documentId,
		file,
		perf,
		signal: control.signal,
	})

	return { documentId, recordCount: parsedCount + recordDelta, diagnostics }
}

// ── Stream processing ────────────────────────────────────────────────────────

async function streamFileInChunks(params: {
	file: File
	sax: ReturnType<typeof setSaxParser>
	session: ParseSession
	store: ImportTarget
	documentId: string
	chunkSize: number
	batchSize: number
	perf: Perf
	control: ImportControl
}): Promise<number> {
	const { file, sax, session, store, documentId, chunkSize, batchSize, perf, control } = params

	const batchParams = { sax, session, store, documentId, file, perf, control }
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
					progress: { phase: 'storing', bytesRead, totalBytes: file.size },
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
				progress: { phase: 'storing', bytesRead, totalBytes: file.size },
			})
		}
	}

	return totalRecords
}

// ── End of the import session ────────────────────────────────────────────────

async function endImportSession(params: {
	importSession?: ImportSession
	store: ImportTarget
	documentId: string
	file: File
	perf: Perf
	signal?: AbortSignal
}): Promise<{ recordDelta: number; diagnostics: Diagnostic[] }> {
	const { importSession, store, documentId, file, perf, signal } = params

	throwIfAborted({ signal, file })
	if (!importSession?.afterImport) return { recordDelta: 0, diagnostics: [] }

	perf.start('import::hooks.after')
	let result: Awaited<ReturnType<NonNullable<ImportSession['afterImport']>>>
	try {
		result = await importSession.afterImport()
	} finally {
		perf.stop('import::hooks.after')
	}
	const { creates, updates, deletes, diagnostics = [] } = result
	const hasOps = creates?.length || updates?.length || deletes?.length
	if (hasOps) {
		throwIfAborted({ signal, file })
		perf.start('import::writes.after')
		try {
			await store.bulkWrite(documentId, { creates, updates, deletes })
		} finally {
			perf.stop('import::writes.after')
		}
	}

	return { recordDelta: (creates?.length ?? 0) - (deletes?.length ?? 0), diagnostics }
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

/** Store the records parsed so far once there are `threshold` of them, then tell the progress. */
async function flushBatch(params: {
	sax: ReturnType<typeof setSaxParser>
	session: ParseSession
	store: ImportTarget
	documentId: string
	file: File
	threshold: number
	perf: Perf
	control: ImportControl
	progress: ImportProgress
}): Promise<number> {
	const { sax, session, store, documentId, file, threshold, perf, control, progress } = params

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
	tellListener({ listener: control.onProgress, value: progress })
	return stored
}
