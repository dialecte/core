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
}
