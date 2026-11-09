import { TRANSPORT_TAG } from './store-contract.constants'

import type { StoreContractSubset, StoreContractTag } from './store-contract.types'

/** Whether a case with these tags runs on a leg running this subset: a transport leg runs the full table only when asked. */
export function runsOnLeg(params: {
	tags: readonly StoreContractTag[]
	subset: StoreContractSubset
	fullTable: boolean
}): boolean {
	const { tags, subset, fullTable } = params
	return subset === 'full' || fullTable || tags.includes(TRANSPORT_TAG)
}
