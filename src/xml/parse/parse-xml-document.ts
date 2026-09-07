import { ParseSession } from './parse-session'
import { setSaxParser } from './parser'

import { NOOP_PERF } from '@/perf'
import { invariant } from '@/utils'

import type { ParseXmlFileParams, ParseXmlFileResult } from './parse-xml-document.types'
import type { Perf } from '@/perf'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

export type { ParseXmlFileParams, ParseXmlFileResult } from './parse-xml-document.types'

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CHUNK_SIZE = 32 * 1024 // 32KB
const DEFAULT_BATCH_SIZE = 2000

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Parse a single XML file and persist records into a Store via chunked streaming.
 *
 * - Uses SAX streaming to avoid loading full XML into memory
 * - Batches records and flushes to Store.bulkWrite in chunks
 * - ParseSession encapsulates parent-child resolution state (no module globals)
 * - Database-agnostic: only calls Store.bulkWrite(documentId, ops)
 */
export async function parseXmlFile(params: ParseXmlFileParams): Promise<ParseXmlFileResult> {
	const {
		documentId,
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
		return { documentId, recordCount: 0 }
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
	const sax = setSaxParser({ dialecteConfig: config, useCustomRecordsIds, session, hooks })

	perf.start('core::import')
	const parsedCount = await streamFileInChunks({
		file,
		sax,
		session,
		store,
		documentId,
		chunkSize,
		batchSize,
		perf,
	})
	perf.stop('core::import')

	const hookDelta = await runAfterImportHook({ hooks, store, documentId })

	return { documentId, recordCount: parsedCount + hookDelta }
}

// ── Stream processing ────────────────────────────────────────────────────────

async function streamFileInChunks(params: {
	file: File
	sax: ReturnType<typeof setSaxParser>
	session: ParseSession
	store: Store
	documentId: string
	chunkSize: number
	batchSize: number
	perf: Perf
}): Promise<number> {
	const { file, sax, session, store, documentId, chunkSize, batchSize, perf } = params

	let totalRecords = 0
	const reader = file.stream().getReader()
	const textDecoder = new TextDecoder()
	let buffer: Uint8Array = new Uint8Array(0)

	let done = false
	while (!done) {
		const result = await reader.read()
		done = result.done

		if (done) {
			if (buffer.length > 0) {
				perf.start('core::import::sax')
				sax.parser.write(textDecoder.decode(buffer))
				perf.stop('core::import::sax')
			}
			sax.parser.close()
			totalRecords += await flushBatch({ sax, session, store, documentId, threshold: 0, perf })
			break
		}

		if (!result.value) continue

		buffer = appendToBuffer(buffer, result.value)

		while (buffer.length >= chunkSize) {
			const chunk = textDecoder.decode(buffer.slice(0, chunkSize), { stream: true })
			buffer = buffer.slice(chunkSize)
			perf.start('core::import::sax')
			sax.parser.write(chunk)
			perf.stop('core::import::sax')

			totalRecords += await flushBatch({
				sax,
				session,
				store,
				documentId,
				threshold: batchSize,
				perf,
			})
		}
	}

	return totalRecords
}

// ── After-import hook ────────────────────────────────────────────────────────

async function runAfterImportHook(params: {
	hooks?: DialecteHooks<AnyDialecteConfig>
	store: Store
	documentId: string
}): Promise<number> {
	const { hooks, store, documentId } = params

	if (!hooks?.afterImport) return 0

	const { creates, updates, deletes } = await hooks.afterImport()
	const hasOps = creates?.length || updates?.length || deletes?.length
	if (!hasOps) return 0

	await store.bulkWrite(documentId, { creates, updates, deletes })
	return (creates?.length ?? 0) - (deletes?.length ?? 0)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function appendToBuffer(existing: Uint8Array, incoming: Uint8Array<ArrayBufferLike>): Uint8Array {
	const merged = new Uint8Array(existing.length + incoming.length)
	merged.set(existing)
	merged.set(incoming, existing.length)
	return merged
}

async function flushBatch(params: {
	sax: ReturnType<typeof setSaxParser>
	session: ParseSession
	store: Store
	documentId: string
	threshold: number
	perf: Perf
}): Promise<number> {
	const { sax, session, store, documentId, threshold, perf } = params

	if (sax.getSize() < threshold) return 0

	const batch = sax.drainBatch()
	perf.start('core::import::resolveChildren')
	const resolved = session.resolveChildrenForBatch(batch)
	perf.stop('core::import::resolveChildren')

	perf.count('core::store::bulkWrite')
	perf.start('core::store::bulkWrite')
	await store.bulkWrite(documentId, { creates: resolved })
	perf.stop('core::store::bulkWrite')
	return resolved.length
}
