import { throwDialecteError } from '@/errors'
import { getAttributeRules } from '@/utils'

import type { AnyAttribute, AnyDialecteConfig, AnyRawRecord } from '@/types'

/**
 * Reject a write whose authored value differs from an attribute's schema `fixed`
 * value (XSD `fixed`), as declared under the record's parent. Runs on the WRITE path
 * only (`addChild`/`ensureChild`/`update`) — never on import, so an existing document
 * that already violates a fixed value can still be loaded. Attributes are matched by
 * their canonical stored name (`prefix:local`), so pass the array produced by
 * `toFullAttributeArray`.
 */
export function assertNoFixedViolation(params: {
	dialecteConfig: AnyDialecteConfig
	record: Pick<AnyRawRecord, 'tagName' | 'parent'>
	attributes: readonly AnyAttribute[]
}): void {
	const { dialecteConfig, record, attributes } = params

	for (const attribute of attributes) {
		const rules = getAttributeRules({ dialecteConfig, record, attributeName: attribute.name })
		if (rules.fixed === undefined) continue
		if (attribute.value === rules.fixed) continue

		throwDialecteError('FIXED_VALUE_VIOLATION', {
			detail: `Attribute '${attribute.name}' on '${record.tagName}' is fixed to '${rules.fixed}' but was set to '${String(attribute.value)}'.`,
			ref: { tagName: record.tagName },
		})
	}
}
