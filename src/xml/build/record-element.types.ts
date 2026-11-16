import type { RootNamespaces } from './root-namespaces'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

/** What every element of one written document is made with. */
export type RecordElementContext = {
	config: AnyDialecteConfig
	declareNamespaces: boolean
	withDatabaseIds: boolean
	/** The document's root record; `undefined` for a fragment, which gets no root attributes. */
	documentRoot: AnyRawRecord | undefined
	/** The namespaces the written records use, each with the one prefix it is written with, declared on the root. */
	namespaces: RootNamespaces
}
