import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

export type BuildXmlDocumentParams = {
	records: AnyRawRecord[]
	config: AnyDialecteConfig
	withDatabaseIds?: boolean
}
