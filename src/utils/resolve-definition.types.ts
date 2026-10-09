import type { AnyRawRecord, Namespace } from '@/types'

/** What resolving a record's definition reads: its tag, parent, attributes (xsi:type, xmlns) and namespace, once known. */
export type ResolvableRecord = Pick<AnyRawRecord, 'tagName' | 'parent' | 'attributes'> & {
	namespace?: Namespace
}
