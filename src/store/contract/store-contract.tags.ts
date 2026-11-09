import {
	IN_PROCESS_ONLY_TABLES,
	TRANSPORT_CASES,
	TRANSPORT_GROUPS,
	TRANSPORT_NEEDS,
	TRANSPORT_TAG,
} from './store-contract.constants'

import type { StoreContractCasePlace, StoreContractTag } from './store-contract.types'

/**
 * The tags of a case: `transport` when it is about what crosses between a client and its engine - it needs one of
 * the transport needs, sits in a transport group or is listed for the wire member it reaches - unless its table runs
 * in-process only.
 */
export function contractTagsOf(params: StoreContractCasePlace): StoreContractTag[] {
	const { table, group, description, needs = [] } = params
	if (IN_PROCESS_ONLY_TABLES.includes(table)) return []
	const listed = TRANSPORT_CASES.some(
		(place) => place.table === table && place.group === group && place.description === description,
	)
	const inTransportGroup = TRANSPORT_GROUPS.some(
		(place) => place.table === table && place.group === group,
	)
	const needsTransport = needs.some((need) => TRANSPORT_NEEDS.includes(need))
	return listed || inTransportGroup || needsTransport ? [TRANSPORT_TAG] : []
}
