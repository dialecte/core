import { UUID_BYTE_COUNT, UUID_DASH_AFTER_BYTES } from './seeded-uuid.constants'

import type { CreateSeededRandomUuidParams, UuidShaped } from './seeded-uuid.types'

/**
 * A stand-in for `crypto.randomUUID` whose ids follow from a seed: the same seed gives the same
 * sequence, every id in the layout of a version 4 UUID - so a check that reads the layout of an id
 * passes, and two runs of the same script mint the same ids. Not for ids that must be unguessable.
 *
 * @example
 * ```ts
 * crypto.randomUUID = createSeededRandomUuid({ seed: 1 })
 * ```
 */
export function createSeededRandomUuid(params: CreateSeededRandomUuidParams): () => UuidShaped {
	let state = params.seed >>> 0

	/** mulberry32: 32 well-mixed bits per step, from one 32-bit state. */
	function nextWord(): number {
		state = (state + 0x6d2b79f5) >>> 0
		let mixed = state
		mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
		return (mixed ^ (mixed >>> 14)) >>> 0
	}

	return function seededRandomUuid(): UuidShaped {
		const bytes = new Uint8Array(UUID_BYTE_COUNT)
		for (let offset = 0; offset < UUID_BYTE_COUNT; offset += 4) {
			const word = nextWord()
			bytes[offset] = word >>> 24
			bytes[offset + 1] = (word >>> 16) & 0xff
			bytes[offset + 2] = (word >>> 8) & 0xff
			bytes[offset + 3] = word & 0xff
		}
		bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
		bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant

		let text = ''
		for (const [position, byte] of bytes.entries()) {
			text += byte.toString(16).padStart(2, '0')
			if (UUID_DASH_AFTER_BYTES.has(position)) text += '-'
		}
		return text as UuidShaped
	}
}
