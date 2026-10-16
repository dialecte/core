import type { AnyRawRecord, Namespace } from '@/types'
import type { SAXParser } from 'sax'

export type ParserInstance = {
	parser: SAXParser
	drainBatch: () => AnyRawRecord[]
	getSize: () => number
}

export type ParserState = {
	defaultNamespace: Namespace | null
	stack: AnyRawRecord[]
	recordsBatch: AnyRawRecord[]
	/** The root element was opened: a second one at depth 0 is a parse error (sax lets it through) */
	sawRoot: boolean
}
