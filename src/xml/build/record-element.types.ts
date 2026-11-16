import type { NamespaceTable } from './root-namespaces.types'
import type { XmlElement } from './xml-element.types'
import type { AnyDialecteConfig } from '@/types'

/** What every element of one written document is made with: read only, the same for the whole document. */
export type RecordElementSettings = {
	config: AnyDialecteConfig
	declareNamespaces: boolean
	withDatabaseIds: boolean
}

/** The element a record is written as, and the namespace table grown by the namespaces it uses. */
export type RecordElement = {
	element: XmlElement
	table: NamespaceTable
}
