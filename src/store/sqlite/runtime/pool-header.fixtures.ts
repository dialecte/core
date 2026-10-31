import {
	HEADER_BYTES,
	HEAD_BYTES,
	FLAGS_OFFSET,
	DIGEST_OFFSET,
	DIGEST_V2,
} from './pool-header.fixtures.constants'

import type { PoolFileHead } from './runtime.types'

/**
 * A pool file's head as sqlite-wasm writes it (`setAssociatedPath`): the path, the flags (the digest flag added when
 * a path is named), their digest - transcribed from sqlite-wasm's `computeDigest`, apart from the code under test.
 */
export function head(params: {
	path: string
	flags: number
	size: number
	digest?: 'kept' | 'damaged' | 'none'
}): PoolFileHead {
	const { path, size, digest = 'kept' } = params
	// sqlite-wasm adds the digest flag to a named file's flags; a header written before it had none ('none')
	const flags = path && params.flags && digest !== 'none' ? params.flags | DIGEST_V2 : params.flags
	const header = new Uint8Array(HEAD_BYTES)
	header.set(new TextEncoder().encode(path))
	new DataView(header.buffer).setUint32(FLAGS_OFFSET, flags)
	const words = [0, 0]
	if (flags & DIGEST_V2) {
		let h1 = 3735928559
		let h2 = 1103547991
		for (const byte of header.subarray(0, DIGEST_OFFSET)) {
			h1 = Math.imul(h1 ^ byte, 2654435761)
			h2 = Math.imul(h2 ^ byte, 104729)
		}
		words[0] = h1 >>> 0
		words[1] = h2 >>> 0
	}
	if (digest === 'damaged') words[0] = (words[0]! + 1) >>> 0
	header.set(new Uint8Array(new Uint32Array(words).buffer), DIGEST_OFFSET)
	return { size, header }
}

/** A file sqlite-wasm made and SQLite never named: a blank header, nothing after it. */
export function blank(params: { size?: number } = {}): PoolFileHead {
	return head({ path: '', flags: 0, size: params.size ?? HEADER_BYTES })
}
