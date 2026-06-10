import { ParseSession } from './parse-session'
import { setSaxParser } from './parser'

import { invariant } from '@/utils'

import type { ParseXmlFileParams, ParseXmlFileResult } from './parse-xml-document.types'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

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
	const { documentId, store, config, useCustomRecordsIds = false, chunkOptions } = params
	let { file } = params

	const { supportedFileExtensions } = config.io

	invariant(
		supportedFileExtensions.some((ext) => file.name.toLowerCase().endsWith(ext)),
		{ key: 'ASSERTION_FAILED', detail: `Unsupported file type: ${file.name}` },
	)

	if (file.size === 0) {
		return { documentId, recordCount: 0 }
	}

	const beforeImport = config.io.hooks?.beforeImport
	if (beforeImport) {
		const rawXml = await file.text()
		const transformed = beforeImport(rawXml)
		file = new File([transformed], file.name, { type: file.type })
	}

	const chunkSize = chunkOptions?.chunkSize ?? DEFAULT_CHUNK_SIZE
	const batchSize = chunkOptions?.batchSize ?? DEFAULT_BATCH_SIZE

	const session = new ParseSession()
	const sax = setSaxParser({ dialecteConfig: config, useCustomRecordsIds, session })

	const parsedCount = await streamFileInChunks({
		file,
		sax,
		session,
		store,
		documentId,
		chunkSize,
		batchSize,
	})

	const hookDelta = await runAfterImportHook({ config, store, documentId })

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
}): Promise<number> {
	const { file, sax, session, store, documentId, chunkSize, batchSize } = params

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
				sax.parser.write(textDecoder.decode(buffer))
			}
			sax.parser.close()
			totalRecords += await flushBatch({ sax, session, store, documentId, threshold: 0 })
			break
		}

		if (!result.value) continue

		buffer = appendToBuffer(buffer, result.value)

		while (buffer.length >= chunkSize) {
			const chunk = textDecoder.decode(buffer.slice(0, chunkSize), { stream: true })
			buffer = buffer.slice(chunkSize)
			sax.parser.write(chunk)

			totalRecords += await flushBatch({ sax, session, store, documentId, threshold: batchSize })
		}
	}

	return totalRecords
}

// ── After-import hook ────────────────────────────────────────────────────────

async function runAfterImportHook(params: {
	config: AnyDialecteConfig
	store: Store
	documentId: string
}): Promise<number> {
	const { config, store, documentId } = params

	if (!config.io.hooks?.afterImport) return 0

	const { creates, updates, deletes } = await config.io.hooks.afterImport()
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
}): Promise<number> {
	const { sax, session, store, documentId, threshold } = params

	if (sax.getSize() < threshold) return 0

	const batch = sax.drainBatch()
	const resolved = session.resolveChildrenForBatch(batch)

	await store.bulkWrite(documentId, { creates: resolved })
	return resolved.length
}
