import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

/** What the namespaces of one written document are made with. */
export type RootNamespacesParams = {
	config: AnyDialecteConfig
	/** The document's root record; `undefined` for a fragment, which gets no root attributes. */
	documentRoot: AnyRawRecord | undefined
}
