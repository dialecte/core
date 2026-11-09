import { ENGINE_WIRE_MEMBERS } from '../sqlite/served/wire/wire.constants'

import type { EngineApi } from '../sqlite/served/engine.types'

/** The members of the engine's wire no call reached, in the wire table's order. */
export function missingWireMembers(params: {
	called: ReadonlySet<keyof EngineApi>
}): (keyof EngineApi)[] {
	const members = Object.keys(ENGINE_WIRE_MEMBERS) as (keyof EngineApi)[]
	return members.filter((member) => !params.called.has(member))
}
