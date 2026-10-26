import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

export type WriteXmlRecordsParams = {
	records: AnyRawRecord[]
	config: AnyDialecteConfig
	rootId?: string
	declareNamespaces?: boolean
	includeXmlDeclaration?: boolean
	withDatabaseIds?: boolean
	indent?: boolean
}
