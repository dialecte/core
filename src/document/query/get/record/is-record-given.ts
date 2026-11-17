import type { RefOrRecord } from '@/document'
import type { AnyDialecteConfig, DialecteRecord, ElementsOf } from '@/types'

/**
 * Whether an input is a record rather than a ref or a relationship: only a record carries a `parent`
 * (a relationship is a tag name and an id).
 *
 * @internal shared by the batch reads, which use a record given as given
 */
export function isRecordGiven<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	refOrRecord: RefOrRecord<GenericConfig, GenericElement>,
): refOrRecord is DialecteRecord<GenericConfig, GenericElement> {
	return 'parent' in refOrRecord
}
