import type { DescendantsFilter, FilterCondition } from './types'
import type { AnyDialecteConfig, ElementsOf } from '@/types'

/**
 * Flatten nested filter to flat array of conditions
 * Each condition represents a level in the descendant chain
 * Conditions without attributes are marked as optional (collect if exists, don't require)
 */
export function flattenFilterToConditions<GenericConfig extends AnyDialecteConfig>(
	filter: DescendantsFilter<GenericConfig>,
): FilterCondition<GenericConfig, ElementsOf<GenericConfig>>[] {
	const conditions: FilterCondition<GenericConfig, ElementsOf<GenericConfig>>[] = [
		{
			tagName: filter.tagName,
			attributes: filter.attributes,
			optional: !filter.attributes || Object.keys(filter.attributes).length === 0,
		},
	]

	if (filter.descendant) {
		conditions.push(
			...flattenFilterToConditions(filter.descendant as DescendantsFilter<GenericConfig>),
		)
	}

	return conditions
}

/**
 * Extract all tag names from nested filter
 */
export function extractTags<GenericConfig extends AnyDialecteConfig>(
	filter: DescendantsFilter<GenericConfig>,
): ElementsOf<GenericConfig>[] {
	const tags: ElementsOf<GenericConfig>[] = [filter.tagName]

	if (filter.descendant) {
		tags.push(...extractTags(filter.descendant as DescendantsFilter<GenericConfig>))
	}

	return tags
}
