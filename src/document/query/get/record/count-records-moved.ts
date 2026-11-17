import { NOOP_PERF } from '@/perf'

import type { StoreReadMember } from './count-records-moved.types'
import type { Perf } from '@/perf'

/**
 * Add the records a store read answered to the dev perf tally `core::store::records.<member>`, beside
 * the read's call tally `core::store::<member>`. A read through a worker costs per record it moves
 * (decode and copy), not per call: the two tallies together show both. An absent answer (an id the
 * store does not hold) moves nothing. Nothing is counted when perf is off: the tally costs one `count` per
 * record only in development.
 *
 * @internal called beside each store read of the query layer
 */
export function countRecordsMoved(params: {
	perf: Perf
	member: StoreReadMember
	records: readonly unknown[]
}): void {
	const { perf, member, records } = params
	if (perf === NOOP_PERF) return
	const name = `core::store::records.${member}`
	for (const record of records) {
		if (record !== undefined) perf.count(name)
	}
}
