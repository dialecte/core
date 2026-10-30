import {
	POOL_FILE,
	POOL_FILE_HEADER,
	POOL_HEADER_DIGEST,
	POOL_HEADER_FLAGS,
} from './runtime.constants'

import type { PoolContents, PoolFileHead } from './runtime.types'

/**
 * What an existing pool holds, from each file's size and header, read before sqlite-wasm installs it: `database` when
 * a header sqlite-wasm keeps names the project's database; else `blank` when no file holds more than its header (the
 * pool never held pages: an install or a creation that ended early); else `lost` - a file holds data and none is the
 * database: sqlite-wasm would drop the damaged header with the pages behind it, and SQLite make a new empty database.
 */
export function classifyPool(params: { files: PoolFileHead[] }): PoolContents {
	const { files } = params
	if (files.some(namesDatabase)) return 'database'
	if (files.every(holdsHeaderOnly)) return 'blank'
	return 'lost'
}

function namesDatabase(file: PoolFileHead): boolean {
	return headerPath({ header: file.header }) === POOL_FILE
}

function holdsHeaderOnly(file: PoolFileHead): boolean {
	return file.size <= POOL_FILE_HEADER.bytes
}

/**
 * The path a pool file's header names, read as sqlite-wasm reads it at install (`getAssociatedPath`): undefined when it
 * drops the header - flags of a file it does not keep under a named path, or a digest that does not match.
 */
function headerPath(params: { header: Uint8Array }): string | undefined {
	const { header } = params
	const corpus = header.subarray(0, POOL_FILE_HEADER.digestOffset)
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
	const flags = view.getUint32(POOL_FILE_HEADER.flagsOffset)
	const unkept =
		(flags & POOL_HEADER_FLAGS.deleteOnClose) !== 0 ||
		(flags & POOL_HEADER_FLAGS.persistentTypes) === 0
	if (corpus[0] !== 0 && unkept) return undefined
	const stored = new Uint32Array(
		header.slice(
			POOL_FILE_HEADER.digestOffset,
			POOL_FILE_HEADER.digestOffset + POOL_FILE_HEADER.digestBytes,
		).buffer,
	)
	const [first, second] = digestOf({ corpus, flags })
	if (stored[0] !== first || stored[1] !== second) return undefined
	const end = corpus.indexOf(0)
	return new TextDecoder().decode(corpus.subarray(0, end === -1 ? corpus.length : end))
}

/** sqlite-wasm's digest of a header's path and flags (`computeDigest`); none (zeros) without the digest flag. */
function digestOf(params: { corpus: Uint8Array; flags: number }): [number, number] {
	const { corpus, flags } = params
	if ((flags & POOL_HEADER_FLAGS.digestV2) === 0) return [0, 0]
	let first: number = POOL_HEADER_DIGEST.seeds[0]
	let second: number = POOL_HEADER_DIGEST.seeds[1]
	const [firstMultiplier, secondMultiplier] = POOL_HEADER_DIGEST.multipliers
	for (const byte of corpus) {
		first = Math.imul(first ^ byte, firstMultiplier)
		second = Math.imul(second ^ byte, secondMultiplier)
	}
	return [first >>> 0, second >>> 0]
}
