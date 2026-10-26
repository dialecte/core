import type { XmlElement } from './xml-element.types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

/** What every element of one written document is made with; `rootElement` is the written root once created. */
export type RecordElementContext = {
	config: AnyDialecteConfig
	declareNamespaces: boolean
	withDatabaseIds: boolean
	/** The document's root record; `undefined` for a fragment, which gets no root attributes. */
	documentRoot: AnyRawRecord | undefined
	rootElement: XmlElement | undefined
}
