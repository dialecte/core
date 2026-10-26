import type { StoreRuntime } from './store-runtime.types'
import type { Perf } from '@/perf'
import type { ExportControl, ExportFileOptions, ExportSource } from '@/store/store.types'
import type { AnyRawRecord } from '@/types'
import type { XmlWriter } from '@/xml/build/xml-writer'

export type RunExportParams = {
	/** The store the records are read from */
	source: ExportSource
	/** The dialecte's configs (and perf): what the document is written with */
	runtime: StoreRuntime
	documentId: string
	options?: ExportFileOptions
}

/** One pass over the document: written whole, or the document changed under it (`moved`). */
export type ExportAttempt = { status: 'written'; file: Blob } | { status: 'moved' }

/** An element being written: its children in the order they are written, read `batchSize` at a time. */
export type ExportFrame = {
	record: AnyRawRecord
	childRefs: AnyRawRecord['children']
	/** The next child to write */
	next: number
	/** The children read last, from `chunkStart`; `undefined` where a child id has no record */
	chunk: (AnyRawRecord | undefined)[]
	chunkStart: number
}

/** What one pass over a document holds while it writes it. */
export type ExportPass = {
	source: ExportSource
	documentId: string
	/** The document's version when the pass began */
	version: number
	totalRecords: number
	control: ExportControl
	perf: Perf
	writer: XmlWriter
	/** The written batches, each a part of the file */
	parts: Blob[]
	recordsWritten: number
}
