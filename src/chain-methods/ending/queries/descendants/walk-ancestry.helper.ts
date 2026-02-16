import { DatabaseInstance } from '@/database'
import { getRecord } from '@/helpers'

import type { AnyDialecteConfig, ChainRecord, ElementsOf, Operation } from '@/types'

/**
 * Walk up from record to focus, collecting all ancestors
 * Stops when reaching focus element (inclusive)
 * Fetches full parent records from database as needed
 */
export async function walkAncestryToFocus<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record: ChainRecord<GenericConfig, GenericElement>
	focus: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	stagedOperations: Operation<GenericConfig>[]
}): Promise<ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { record, focus, dialecteConfig, databaseInstance, stagedOperations } = params

	const ancestry: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[] = []
	let current: ChainRecord<GenericConfig, ElementsOf<GenericConfig>> | null = record

	// Walk up until we reach focus or root
	while (current && current.id !== focus.id) {
		ancestry.push(current)

		// If no parent, we can't continue
		if (!current.parent) {
			return [] // Reached root without finding focus
		}

		// Fetch full parent record from database
		const parentRecord: ChainRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined =
			await getRecord({
				id: current.parent.id,
				tagName: current.parent.tagName as ElementsOf<GenericConfig>,
				stagedOperations,
				dialecteConfig,
				databaseInstance,
				type: 'chain',
			})

		if (!parentRecord) {
			return [] // Parent not found
		}

		current = parentRecord
	}

	// Check if we actually reached the focus
	if (!current || current.id !== focus.id) {
		return [] // Record is not a descendant of focus
	}

	// Include focus in ancestry
	ancestry.push(current)

	return ancestry
}
