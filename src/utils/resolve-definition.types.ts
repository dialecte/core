import type { AnyDialecteConfig, AnyRawRecord, Namespace } from '@/types'

/** What resolving reads of a dialecte: its definition, its types and its namespaces. */
export type DefinitionConfig = Pick<AnyDialecteConfig, 'definition' | 'types' | 'namespaces'>

/** What resolving a record's definition reads: its tag, parent, attributes (xsi:type, xmlns) and namespace, once known. */
export type ResolvableRecord = Pick<AnyRawRecord, 'tagName' | 'parent' | 'attributes'> & {
	namespace?: Namespace
}
