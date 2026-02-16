import { matchesAttributeFilter } from '@/helpers'

import type { FilterCondition } from './types'
import type { AnyDialecteConfig, ChainRecord, ElementsOf } from '@/types'

/**
 * Check if all required filter conditions exist in ancestry chain (any depth)
 * Optional conditions (no attributes) are skipped if not found
 */
export function matchesAllConditions<GenericConfig extends AnyDialecteConfig>(params: {
	ancestry: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]
	conditions: FilterCondition<GenericConfig, ElementsOf<GenericConfig>>[]
}): boolean {
	const { ancestry, conditions } = params

	// Every REQUIRED condition must have at least one matching ancestor
	// Optional conditions (no attributes) are allowed to be missing
	return conditions.every((condition) => {
		const found = ancestry.some((ancestor) => {
			// Tag must match
			if (ancestor.tagName !== condition.tagName) {
				return false
			}

			// If no attributes specified, tag match is sufficient
			if (!condition.attributes) {
				return true
			}

			// Check attribute filters
			return matchesAttributeFilter({
				record: ancestor,
				attributeFilter: condition.attributes,
			})
		})

		// If not found, only pass if condition is optional
		return found || condition.optional === true
	})
}
