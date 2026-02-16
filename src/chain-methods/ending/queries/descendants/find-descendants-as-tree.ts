import { flattenFilterToConditions } from './filter-utils.helper'
import { createFindDescendantsMethod } from './find-descendants'

import { DatabaseInstance } from '@/database'

import type { DescendantsFilter } from './types'
import type { AnyDialecteConfig, Context, ElementsOf, ChainRecord, TreeRecord } from '@/types'

export function createFindDescendantsAsTreeMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	const { contextPromise, dialecteConfig, databaseInstance } = params

	async function findDescendantsAsTree<GenericFilter extends DescendantsFilter<GenericConfig>>(
		filter: GenericFilter,
	): Promise<TreeRecord<GenericConfig, GenericFilter['tagName']>[]> {
		const findDescendants = createFindDescendantsMethod({
			contextPromise,
			dialecteConfig,
			databaseInstance,
		})

		const flatRecords = await findDescendants(filter)

		// id->record map for fast lookup
		const recordMap = new Map<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>>()

		const allRecords = Object.values(flatRecords) as ChainRecord<
			GenericConfig,
			ElementsOf<GenericConfig>
		>[][]

		for (const records of allRecords) {
			for (const record of records) {
				recordMap.set(record.id, record)
			}
		}

		if (recordMap.size === 0) return []

		const conditions = flattenFilterToConditions(filter)
		const deepestTagName = conditions[conditions.length - 1].tagName

		const filterRootTagName = filter.tagName
		const rootRecords = Array.from(recordMap.values()).filter(
			(r) => r.tagName === filterRootTagName,
		)

		// Build tree recursively
		return rootRecords.map((root) => buildTree(root))

		function buildTree(
			record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>,
		): TreeRecord<GenericConfig, ElementsOf<GenericConfig>> {
			// If this is the deepest element, don't build children (tree: [])
			if (record.tagName === deepestTagName) {
				return {
					...record,
					tree: [],
				} as TreeRecord<GenericConfig, ElementsOf<GenericConfig>>
			}

			// Build children from collected records (only those in recordMap)
			const childrenTrees = record.children
				.map((childRef) => recordMap.get(childRef.id))
				.filter((child): child is NonNullable<typeof child> => child !== undefined)
				.map((child) => buildTree(child))

			return {
				...record,
				tree: childrenTrees,
			} as TreeRecord<GenericConfig, ElementsOf<GenericConfig>>
		}
	}

	return findDescendantsAsTree
}
