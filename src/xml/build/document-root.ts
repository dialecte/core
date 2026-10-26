import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

/** Whether the record is its document's root element: the dialecte's root tag, with no parent. */
export function isDocumentRoot(params: {
	record: AnyRawRecord
	config: AnyDialecteConfig
}): boolean {
	const { record, config } = params
	return record.tagName === config.rootElementName && record.parent === null
}
