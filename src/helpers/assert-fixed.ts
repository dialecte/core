import { throwDialecteError } from '@/errors'
import { getAttributeRules } from '@/utils'

import type { AnyAttribute, AnyDialecteConfig } from '@/types'

/**
 * Reject a write whose authored value differs from an attribute's schema `fixed`
 * value (XSD `fixed`). Runs on the WRITE path only (`addChild`/`ensureChild`/
 * `update`) — never on import, so an existing document that already violates a
 * fixed value can still be loaded. Attributes are matched by their canonical stored
 * name (`prefix:local`), so pass the array produced by `toFullAttributeArray`.
 */
export function assertNoFixedViolation(params: {
	dialecteConfig: AnyDialecteConfig
	tagName: string
	attributes: readonly AnyAttribute[]
}): void {
	const { dialecteConfig, tagName, attributes } = params

	for (const attribute of attributes) {
		const rules = getAttributeRules({ dialecteConfig, tagName, attributeName: attribute.name })
		if (rules.fixed === undefined) continue
		if (attribute.value === rules.fixed) continue

		throwDialecteError('FIXED_VALUE_VIOLATION', {
			detail: `Attribute '${attribute.name}' on '${tagName}' is fixed to '${rules.fixed}' but was set to '${String(attribute.value)}'.`,
			ref: { tagName },
		})
	}
}
