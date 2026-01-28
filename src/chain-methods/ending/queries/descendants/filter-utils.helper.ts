import type { DescendantsFilter, PathLevel } from './types'
import type { AnyDialecteConfig, ElementsOf } from '@/types'

/**
 * Flatten nested filter to ordered path array (root to leaf)
 */
export function filterToPath<GenericConfig extends AnyDialecteConfig>(
	filter: DescendantsFilter<GenericConfig>,
): PathLevel<GenericConfig, ElementsOf<GenericConfig>>[] {
	const path: PathLevel<GenericConfig, ElementsOf<GenericConfig>>[] = [
		{
			tagName: filter.tagName,
			attributes: filter.attributes,
		},
	]

	if (filter.descendant) {
		path.push(...filterToPath(filter.descendant as DescendantsFilter<GenericConfig>))
	}

	return path
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
