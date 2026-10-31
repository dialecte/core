import { classifyPool } from './pool-header'
import { blank, head } from './pool-header.fixtures'
import {
	HEADER_BYTES,
	DELETE_ON_CLOSE,
	MAIN_DB,
	MAIN_JOURNAL,
	DATA,
} from './pool-header.fixtures.constants'
import { POOL_FILE } from './runtime.constants'

import { describe, expect, it } from 'vitest'

import type { PoolContents, PoolFileHead } from './runtime.types'

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
