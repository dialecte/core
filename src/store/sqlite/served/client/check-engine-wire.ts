import { ENGINE_WIRE_PROTOCOL } from '../wire/wire.constants'

import { createDialecteError } from '@/errors'

/**
 * An engine of another library version speaks another wire: refused `STORE_PROTOCOL_MISMATCH`, naming
 * both versions (its caller ends it, as a failed open).
 */
export function refuseAnotherWire(params: { found: number }): void {
	const { found } = params
	if (found === ENGINE_WIRE_PROTOCOL) return
	throw createDialecteError('STORE_PROTOCOL_MISMATCH', {
		detail: `The project engine speaks wire version ${found}, this page ${ENGINE_WIRE_PROTOCOL}: another version of the library`,
		meta: { expected: ENGINE_WIRE_PROTOCOL, found },
	})
}
