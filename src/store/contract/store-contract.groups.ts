import { STORE_ANNOUNCE_CONTRACT } from './store-contract.announce.cases'
import { STORE_ATTRIBUTE_CONTRACT } from './store-contract.attribute-lookup.cases'
import { STORE_CONTRACT } from './store-contract.cases'
import { STORE_EXPORT_CONTRACT } from './store-contract.export.cases'
import { STORE_MOVE_CONTRACT } from './store-contract.move.cases'
import { STORE_PATH_CONTRACT } from './store-contract.path.cases'
import { STORE_TAG_INDEX_CONTRACT } from './store-contract.tag-index.cases'
import { STORE_TEXT_CONTRACT } from './store-contract.text.cases'
import { STORE_VERSIONED_READ_CONTRACT } from './store-contract.versioned-read.cases'
import { STORE_WELL_FORMED_CONTRACT } from './store-contract.well-formed.cases'

import type {
	StoreContractCases,
	StoreContractGroup,
	StoreContractTable,
} from './store-contract.types'

/** Every group of the contract with its table, in the order the cases run. */
export function contractGroups(): StoreContractGroup[] {
	const tables: Record<StoreContractTable, Record<string, StoreContractCases>> = {
		store: {
			...STORE_CONTRACT,
			...STORE_TAG_INDEX_CONTRACT,
			...STORE_MOVE_CONTRACT,
			...STORE_ATTRIBUTE_CONTRACT,
			...STORE_VERSIONED_READ_CONTRACT,
		},
		announce: STORE_ANNOUNCE_CONTRACT,
		export: STORE_EXPORT_CONTRACT,
		path: STORE_PATH_CONTRACT,
		text: STORE_TEXT_CONTRACT,
		'well-formed': STORE_WELL_FORMED_CONTRACT,
	}
	return Object.entries(tables).flatMap(([table, groups]) =>
		Object.entries(groups).map(([group, cases]) => ({
			table: table as StoreContractTable,
			group,
			cases,
		})),
	)
}
