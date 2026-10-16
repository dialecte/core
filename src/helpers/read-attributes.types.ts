import type { AnyDialecteConfig, AnyRawRecord } from '@/types'
import type { AttributeDefaults } from '@/utils'

/** What every attribute read takes: the record as held (raw, tracked or tree), the config its schema values come from. */
export type ReadAttributesBaseParams = {
	record: AnyRawRecord
	dialecteConfig: AnyDialecteConfig
	/** How an absent schema attribute is filled - as in `query.getAttribute(s)`. Default `'optional'`. */
	defaults?: AttributeDefaults
}
