import type { CollectedTags, ResultMap } from './types'
import type { AnyDialecteConfig, ChainRecord, ElementsOf } from '@/types'

/**
 * Group records by tagName
 */
export function groupByTag<GenericConfig extends AnyDialecteConfig>(
	records: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[],
	includeTags?: Set<string>,
): Partial<ResultMap<GenericConfig, string>> {
	const grouped: Partial<ResultMap<GenericConfig, string>> = {}

	for (const record of records) {
		if (includeTags && !includeTags.has(record.tagName)) continue

		if (!grouped[record.tagName]) {
			grouped[record.tagName] = []
		}
		grouped[record.tagName]!.push(record)
	}

	return grouped
}

/**
 * Deduplicate records by id within each tag
 */
export function deduplicateByTag<GenericConfig extends AnyDialecteConfig>(
	collected: CollectedTags<GenericConfig>,
): CollectedTags<GenericConfig> {
	const deduplicated = new Map<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]>()

	for (const [tagName, records] of collected.entries()) {
		const uniqueMap = new Map<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>>()

		for (const record of records) {
			uniqueMap.set(record.id, record)
		}

		deduplicated.set(tagName, Array.from(uniqueMap.values()))
	}

	return deduplicated
}

/**
 * Convert Map to result object with empty arrays for missing tags
 */
export function mapToResult<GenericConfig extends AnyDialecteConfig>(
	collected: CollectedTags<GenericConfig>,
	tags: Set<string>,
): Record<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const result: Record<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]> = {}

	for (const tag of tags) {
		result[tag] = collected.get(tag) || []
	}

	return result
}
