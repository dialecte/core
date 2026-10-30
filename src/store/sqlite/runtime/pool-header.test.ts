import { classifyPool } from './pool-header'
import { POOL_FILE } from './runtime.constants'

import { describe, expect, it } from 'vitest'

import type { PoolContents, PoolFileHead } from './runtime.types'

// sqlite-wasm's header layout and SQLite's flags, written out here: the test does not lean on the constants it checks
const HEADER_BYTES = 4096
const HEAD_BYTES = 524
const FLAGS_OFFSET = 512
const DIGEST_OFFSET = 516
const DELETE_ON_CLOSE = 0x8
const DIGEST_V2 = 0x80
const MAIN_DB = 0x100
const MAIN_JOURNAL = 0x800
const DATA = HEADER_BYTES + 8192

/**
 * A pool file's head as sqlite-wasm writes it (`setAssociatedPath`): the path, the flags (the digest flag added when
 * a path is named), their digest - transcribed from sqlite-wasm's `computeDigest`, apart from the code under test.
 */
function head(params: {
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
function blank(params: { size?: number } = {}): PoolFileHead {
	return head({ path: '', flags: 0, size: params.size ?? HEADER_BYTES })
}

const cases: Record<string, { files: PoolFileHead[]; expected: PoolContents }> = {
	'the database named by a kept header, beside blank files': {
		files: [blank(), head({ path: POOL_FILE, flags: MAIN_DB, size: DATA }), blank()],
		expected: 'database',
	},
	'the database named, header-sized (created, no page written yet)': {
		files: [head({ path: POOL_FILE, flags: MAIN_DB, size: HEADER_BYTES }), blank()],
		expected: 'database',
	},
	'the database named by a header without a digest (written before sqlite-wasm had one), holding data':
		{
			files: [head({ path: POOL_FILE, flags: MAIN_DB, size: DATA, digest: 'none' }), blank()],
			expected: 'database',
		},
	'the database named, beside a slot holding data whose header is damaged (a journal torn as it was dropped)':
		{
			files: [
				head({ path: POOL_FILE, flags: MAIN_DB, size: DATA }),
				head({ path: `${POOL_FILE}-journal`, flags: MAIN_JOURNAL, size: DATA, digest: 'damaged' }),
				blank({ size: DATA }),
			],
			expected: 'database',
		},
	'only blank files (installed, no database made)': {
		files: [blank(), blank(), blank()],
		expected: 'blank',
	},
	'a partial pool (an install that ended while making its files)': {
		files: [blank(), blank({ size: 0 })],
		expected: 'blank',
	},
	'a pool without files': { files: [], expected: 'blank' },
	'the database header-sized and its digest damaged (torn as it was created)': {
		files: [head({ path: POOL_FILE, flags: MAIN_DB, size: HEADER_BYTES, digest: 'damaged' })],
		expected: 'blank',
	},
	'the database holding data, its digest damaged': {
		files: [head({ path: POOL_FILE, flags: MAIN_DB, size: DATA, digest: 'damaged' }), blank()],
		expected: 'lost',
	},
	'the database holding data, its header blank': {
		files: [blank({ size: DATA }), blank()],
		expected: 'lost',
	},
	'the database holding data, its flags of a file sqlite-wasm does not keep': {
		files: [head({ path: POOL_FILE, flags: DELETE_ON_CLOSE | MAIN_DB, size: DATA })],
		expected: 'lost',
	},
	'a journal holding data, no database': {
		files: [head({ path: `${POOL_FILE}-journal`, flags: MAIN_JOURNAL, size: DATA }), blank()],
		expected: 'lost',
	},
	'another file named, holding data, no database': {
		files: [head({ path: '/other.sqlite3', flags: MAIN_DB, size: DATA })],
		expected: 'lost',
	},
}

describe('classifyPool', () => {
	it.each(Object.entries(cases))('%s', (_label, { files, expected }) => {
		expect(classifyPool({ files })).toBe(expected)
	})
})
