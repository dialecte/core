import { resolveConfig } from './resolve-config'

import { throwDialecteError } from '@/errors'
import { createPerf } from '@/perf'
import { EXPORT_BATCH_SIZE } from '@/store/store.constants'
import { orderByConfigSequence } from '@/utils'
import { tellListener } from '@/utils/tell-listener'
import { TOLD_OF } from '@/utils/tell-listener.constants'
import { yieldToQueue } from '@/utils/yield-to-queue'
import { isDocumentRoot } from '@/xml/build/document-root'
import { XmlWriter } from '@/xml/build/xml-writer'

import type { ExportAttempt, ExportFrame, ExportPass, RunExportParams } from './run-export.types'
import type { Perf } from '@/perf'
import type { DocumentRecord } from '@/project/types'
import type { ExportControl, ExportFileResult, ExportSource } from '@/store/store.types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

/**
 * The export of one document, next to the data - what every store's `exportFile` runs. The records are read
 * parent by parent, `batchSize` children per call in the order they are written (never the whole document in
 * one call), and written as they come; each written batch becomes a part of the answered `Blob`, whose head
 * (declaration and root start tag) is put in front at the end. A write on the document while it is exported
 * restarts it once from the start; a second one fails it with `EXPORT_CONFLICT`. The progress listener and the
 * abort come apart from the export's data, as a worker call carries them.
 */
export async function runExport(
	params: RunExportParams,
	control: ExportControl = {},
): Promise<ExportFileResult> {
	const { source, runtime, documentId } = params
	const perf = createPerf({ enabled: runtime.perf ?? false, timeline: false })

	throwIfExportAborted({ signal: control.signal, documentId })
	const document = await readyDocumentOf({ source, documentId })
	const { config } = resolveConfig({
		configs: runtime.configs,
		defaultConfigKey: runtime.defaultConfigKey,
		configKey: document.configKey,
	})

	const batchSize = batchSizeOf({ options: params.options })
	perf.start('export')
	let attempt: ExportAttempt
	try {
		const first = await exportOnce({ ...params, config, control, perf, batchSize })
		attempt =
			first.status === 'moved'
				? await exportOnce({ ...params, config, control, perf, batchSize })
				: first
	} finally {
		perf.stop('export')
	}
	if (attempt.status === 'moved') {
		throwDialecteError('EXPORT_CONFLICT', {
			detail: `Document "${document.name}" changed twice while it was exported: export it again`,
			meta: { documentId },
		})
	}
	return {
		file: attempt.file,
		filename: `${document.name}${document.extension}`,
		...(runtime.perf && { perf: perf.snapshot() }),
	}
}

/** The records read per call and written per batch: a whole number from 1, `EXPORT_BATCH_SIZE` by default. */
function batchSizeOf(params: { options: RunExportParams['options'] }): number {
	const batchSize = params.options?.batchSize ?? EXPORT_BATCH_SIZE
	if (!Number.isInteger(batchSize) || batchSize < 1) {
		throwDialecteError('ASSERTION_FAILED', {
			detail: `An export batch size is a whole number from 1, not ${batchSize}`,
		})
	}
	return batchSize
}

/** The registered document, `ready`; one not registered, or still importing, cannot be exported. */
async function readyDocumentOf(params: {
	source: ExportSource
	documentId: string
}): Promise<DocumentRecord> {
	const { source, documentId } = params
	const document = await source.getDocument(documentId)
	if (!document || document.status !== 'ready') throwDocumentGone({ documentId })
	return document
}

// ── One pass ─────────────────────────────────────────────────────────────────

/** Write the document once, from its root; `moved` as soon as its version changes. */
async function exportOnce(
	params: RunExportParams & {
		config: AnyDialecteConfig
		control: ExportControl
		perf: Perf
		batchSize: number
	},
): Promise<ExportAttempt> {
	const { source, documentId, options, config, control, perf, batchSize } = params
	const version = await source.getExportVersion({ documentId })
	if (version === undefined) throwDocumentGone({ documentId })
	const totalRecords = await source.count(documentId)

	const rootRecord = await rootOf({ source, documentId, config })
	if (!rootRecord) {
		if (await hasMoved({ source, documentId, version })) return { status: 'moved' }
		throwDialecteError('EXPORT_ROOT_NOT_FOUND', {
			detail: `No ${config.rootElementName} root element found in document "${documentId}"`,
		})
	}

	const pass: ExportPass = {
		source,
		documentId,
		version,
		totalRecords,
		control,
		perf,
		writer: new XmlWriter({
			config,
			documentRoot: rootRecord,
			indent: options?.indent,
			withDatabaseIds: options?.withDatabaseIds,
		}),
		parts: [],
		recordsWritten: 0,
	}
	const frames: ExportFrame[] = [openFrame({ pass, record: rootRecord, config })]
	if (pass.recordsWritten % batchSize === 0 && (await endBatch(pass))) return { status: 'moved' }

	while (frames.length > 0) {
		const frame = frames.at(-1)!
		if (frame.next >= frame.childRefs.length) {
			perf.time('export::write', () => pass.writer.closeElement())
			frames.pop()
			continue
		}
		if (frame.next >= frame.chunkStart + frame.chunk.length) {
			const ids = frame.childRefs.slice(frame.next, frame.next + batchSize).map(idOf)
			perf.start('export::read')
			try {
				frame.chunk = await source.getMany(ids, documentId)
			} finally {
				perf.stop('export::read')
			}
			frame.chunkStart = frame.next
		}
		const childRef = frame.childRefs[frame.next]!
		const child = frame.chunk[frame.next - frame.chunkStart]
		frame.next++
		if (!child) {
			if (await hasMoved(pass)) return { status: 'moved' }
			throwDialecteError('EXPORT_ORPHAN_CHILD_REF', {
				detail: `Parent '${frame.record.tagName}' references non-existent child '${childRef.tagName}' (id: ${childRef.id})`,
				ref: { tagName: frame.record.tagName, id: frame.record.id },
			})
		}
		frames.push(openFrame({ pass, record: child, config }))
		if (pass.recordsWritten % batchSize === 0 && (await endBatch(pass))) return { status: 'moved' }
	}

	// the closing tags written since; the last batch, unless the last record ended one
	takePart(pass)
	if (pass.recordsWritten % batchSize !== 0 && (await endBatch(pass))) return { status: 'moved' }
	perf.start('export::assemble')
	try {
		return {
			status: 'written',
			file: new Blob([pass.writer.head(), ...pass.parts], { type: 'application/xml' }),
		}
	} finally {
		perf.stop('export::assemble')
	}
}

/** Open the record's element and the frame its children are written from, in the dialecte's sequence. */
function openFrame(params: {
	pass: ExportPass
	record: AnyRawRecord
	config: AnyDialecteConfig
}): ExportFrame {
	const { pass, record, config } = params
	pass.perf.time('export::write', () => pass.writer.openElement({ record }))
	pass.recordsWritten++
	return {
		record,
		childRefs: orderByConfigSequence({
			parentTagName: record.tagName,
			children: record.children,
			childrenConfig: config.children,
			definition: config.definition,
		}),
		next: 0,
		chunk: [],
		chunkStart: 0,
	}
}

/** The record of the document's root element: the root tag, with no parent. */
async function rootOf(params: {
	source: ExportSource
	documentId: string
	config: AnyDialecteConfig
}): Promise<AnyRawRecord | undefined> {
	const { source, documentId, config } = params
	const roots = await source.getByTagNameInDocument(config.rootElementName, documentId)
	return roots.find((record) => isDocumentRoot({ record, config }))
}

/**
 * End a written batch: it becomes a part of the file, the listener is told, an abort is honoured, other callers'
 * work runs (a commit among them), then the version is read. `true` when the document moved meanwhile.
 */
async function endBatch(pass: ExportPass): Promise<boolean> {
	const { control, documentId, recordsWritten, totalRecords } = pass
	takePart(pass)
	tellListener({
		listener: control.onProgress,
		value: { recordsWritten, totalRecords },
		of: TOLD_OF.exportProgress,
		// the export's ticks: a listener failing at each one reported once
		call: control,
	})
	throwIfExportAborted({ signal: control.signal, documentId })
	await yieldToQueue()
	return hasMoved(pass)
}

/** What the writer wrote since the last part becomes the next part of the file. */
function takePart(pass: ExportPass): void {
	const written = pass.writer.take()
	if (written) pass.parts.push(new Blob([written]))
}

/**
 * Whether the document took a write since the pass began (`true`), or is gone (`DOCUMENT_NOT_REGISTERED`):
 * every batch read under an unchanged version reads one state.
 */
async function hasMoved(params: {
	source: ExportSource
	documentId: string
	version: number
}): Promise<boolean> {
	const { source, documentId, version } = params
	const current = await source.getExportVersion({ documentId })
	if (current === undefined) throwDocumentGone({ documentId })
	return current !== version
}

function idOf(ref: { id: string }): string {
	return ref.id
}

function throwDocumentGone(params: { documentId: string }): never {
	const { documentId } = params
	throwDialecteError('DOCUMENT_NOT_REGISTERED', {
		detail: `Document "${documentId}" is not registered, or not ready, in this store`,
		meta: { documentId },
	})
}

/** An aborted export goes no further: `EXPORT_ABORTED`. */
export function throwIfExportAborted(params: { signal?: AbortSignal; documentId: string }): void {
	const { signal, documentId } = params
	if (!signal?.aborted) return
	throwDialecteError('EXPORT_ABORTED', {
		detail: `The export of document "${documentId}" was aborted`,
		meta: { documentId },
	})
}
