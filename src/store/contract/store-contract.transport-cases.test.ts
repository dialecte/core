import { TRANSPORT_CASES } from './store-contract.constants'
import { contractGroups } from './store-contract.groups'

import { describe, expect, it } from 'vitest'

describe('the cases listed for the wire member they reach', () => {
	it('each names a case of its table and group: a renamed case fails here, not by dropping out of the subset', () => {
		const groups = contractGroups()
		expect(
			TRANSPORT_CASES.filter(function missing(listed) {
				const group = groups.find(
					(place) => place.table === listed.table && place.group === listed.group,
				)
				return group === undefined || !(listed.description in group.cases)
			}),
		).toEqual([])
	})
})
