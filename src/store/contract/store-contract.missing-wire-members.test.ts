import { ENGINE_WIRE_MEMBERS } from '../sqlite/served/wire/wire.constants'
import { missingWireMembers } from './store-contract.missing-wire-members'

import { describe, expect, it } from 'vitest'

import type { EngineApi } from '../sqlite/served/engine.types'

const EVERY_MEMBER = Object.keys(ENGINE_WIRE_MEMBERS) as (keyof EngineApi)[]

describe('missingWireMembers', () => {
	it('every member of the wire called: none missing', () => {
		expect(missingWireMembers({ called: new Set(EVERY_MEMBER) })).toEqual([])
	})

	it('a member no case called on the leg: named, in the wire table order', () => {
		const called = new Set(
			EVERY_MEMBER.filter((member) => member !== 'getStandaloneBlobs' && member !== 'undo'),
		)
		expect(missingWireMembers({ called })).toEqual(['undo', 'getStandaloneBlobs'])
	})

	it('nothing called: every member, in the wire table order', () => {
		expect(missingWireMembers({ called: new Set() })).toEqual(EVERY_MEMBER)
	})
})
