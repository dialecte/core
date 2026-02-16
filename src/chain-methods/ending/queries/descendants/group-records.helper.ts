import type { AnyDialecteConfig, ChainRecord, ElementsOf } from '@/types'

/**
 * Group records by tagName and deduplicate by id
 */
export function groupAndDeduplicate<GenericConfig extends AnyDialecteConfig>(params: {
	collected: Map<string, Map<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>>>
	collectTags: Set<string>
}): Record<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { collected, collectTags } = params

	const result: Record<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]> = {}

	// Initialize all tags with empty arrays
	for (const tag of collectTags) {
		result[tag] = []
	}

	// Convert Maps to arrays (Maps deduplicate by id)
	for (const [tagName, recordMap] of collected.entries()) {
		if (collectTags.has(tagName)) {
			result[tagName] = Array.from(recordMap.values())
		}
	}

	return result
}
