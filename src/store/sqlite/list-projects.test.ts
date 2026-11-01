import { LAYOUT_VERSION } from './engine/engine.constants'
import { listProjectsIn } from './list-projects'
import { blank, head } from './runtime/pool-header.fixtures'
import { DATA, HEADER_BYTES, MAIN_DB } from './runtime/pool-header.fixtures.constants'
import { POOL_FILE } from './runtime/runtime.constants'

import { describe, expect, it } from 'vitest'

import type { ProjectListing } from './list-projects.types'
import type { PoolFileHead } from './runtime/runtime.types'

/** A fake file: its bytes, when written, or a read the browser refuses `failures` times first. */
type FakeFile = {
	kind: 'file'
	name: string
	bytes: Uint8Array<ArrayBuffer>
	lastModified: number
	failures?: number
}
/** A fake directory: `vanished` - removed as it is read; `refused` - the browser refuses to open it. */
type FakeDirectory = {
	kind: 'directory'
	name: string
	children: (FakeFile | FakeDirectory)[]
	vanished?: boolean
	refused?: boolean
}

/** A project's pool as a case lays it: its files, its directory's own name, removed or refused as it is read. */
type ProjectFixture = {
	dialecteId: string
	name: string
	files: FakeFile[]
	directoryName?: string
	vanished?: boolean
	opaqueRefused?: boolean
}

/** A pool file: its pool header (as sqlite-wasm writes it), then its data - a SQLite header of `version` when given. */
function poolFile(params: {
	name: string
	head: PoolFileHead
	version?: number
	lastModified?: number
	failures?: number
}): FakeFile {
	const { name, version, lastModified = 1_000, failures } = params
	const bytes = new Uint8Array(params.head.size)
	bytes.set(params.head.header)
	if (version !== undefined) {
		const data = new Uint8Array(100)
		data.set(new TextEncoder().encode('SQLite format 3\0'))
		new DataView(data.buffer).setUint32(60, version)
		bytes.set(data, HEADER_BYTES)
	}
	return { kind: 'file', name, bytes, lastModified, failures }
}

function database(params: {
	version?: number
	lastModified?: number
	failures?: number
}): FakeFile {
	return poolFile({
		name: 'a',
		head: head({ path: POOL_FILE, flags: MAIN_DB, size: DATA }),
		...params,
	})
}

function blankFile(params: { name: string }): FakeFile {
	return poolFile({ name: params.name, head: blank() })
}

/** The pools of `projects` under the origin's root, each in `dialecte-projects/<dialecte>/<name>/` (both encoded). */
function originWith(params: { projects: ProjectFixture[] }): FileSystemDirectoryHandle {
	const dialectes = new Map<string, FakeDirectory>()
	for (const {
		dialecteId,
		name,
		files,
		directoryName,
		vanished,
		opaqueRefused,
	} of params.projects) {
		const key = encodeURIComponent(dialecteId)
		const dialecte = dialectes.get(key) ?? { kind: 'directory', name: key, children: [] }
		dialectes.set(key, dialecte)
		dialecte.children.push({
			kind: 'directory',
			name: directoryName ?? encodeURIComponent(name),
			// sqlite-wasm keeps a pool's files in its `.opaque` directory
			children: [{ kind: 'directory', name: '.opaque', children: files, refused: opaqueRefused }],
			vanished,
		})
	}
	const root: FakeDirectory = {
		kind: 'directory',
		name: '',
		children: [{ kind: 'directory', name: 'dialecte-projects', children: [...dialectes.values()] }],
	}
	return handleOf(root) as FileSystemDirectoryHandle
}

/** A fake entry as the File System Access API answers it: as far as listing reads it. */
function handleOf(entry: FakeFile | FakeDirectory): unknown {
	if (entry.kind === 'file') {
		let failures = entry.failures ?? 0
		return {
			kind: 'file',
			name: entry.name,
			getFile: async function getFile() {
				if (failures > 0) {
					failures -= 1
					throw new DOMException('written by its engine', 'NotReadableError')
				}
				return new File([entry.bytes], entry.name, { lastModified: entry.lastModified })
			},
		}
	}
	return {
		kind: 'directory',
		name: entry.name,
		values: async function* values() {
			if (entry.vanished) throw new DOMException('removed meanwhile', 'NotFoundError')
			if (entry.refused) throw new DOMException('not allowed', 'NotAllowedError')
			for (const child of entry.children) yield handleOf(child)
		},
		getDirectoryHandle: async function getDirectoryHandle(name: string) {
			const child = entry.children.find((candidate) => candidate.name === name)
			if (child?.kind !== 'directory' || child.vanished)
				throw new DOMException('not found', 'NotFoundError')
			return handleOf(child)
		},
	}
}

describe('listProjectsIn', () => {
	type TestCase = {
		projects: ProjectFixture[]
		dialecteId?: string
		expected: Pick<ProjectListing, 'dialecteId' | 'name' | 'state'>[]
	}
	const testCases: Record<string, TestCase> = {
		'two projects of this layout → both current, sorted by dialecte then name': {
			projects: [
				{ dialecteId: 'scl', name: 'north', files: [database({ version: LAYOUT_VERSION })] },
				{ dialecteId: 'nsd', name: 'lib', files: [database({ version: LAYOUT_VERSION })] },
				{ dialecteId: 'scl', name: 'east', files: [database({ version: LAYOUT_VERSION })] },
			],
			expected: [
				{ dialecteId: 'nsd', name: 'lib', state: 'current' },
				{ dialecteId: 'scl', name: 'east', state: 'current' },
				{ dialecteId: 'scl', name: 'north', state: 'current' },
			],
		},
		'a database of another layout → outdated': {
			projects: [
				{ dialecteId: 'scl', name: 'old', files: [database({ version: LAYOUT_VERSION - 1 })] },
			],
			expected: [{ dialecteId: 'scl', name: 'old', state: 'outdated' }],
		},
		'files holding data, no database named → lost': {
			projects: [
				{
					dialecteId: 'scl',
					name: 'damaged',
					files: [
						poolFile({
							name: 'a',
							head: head({ path: POOL_FILE, flags: MAIN_DB, size: DATA, digest: 'damaged' }),
						}),
					],
				},
			],
			expected: [{ dialecteId: 'scl', name: 'damaged', state: 'lost' }],
		},
		'blank files only (made, never written) → new': {
			projects: [
				{
					dialecteId: 'scl',
					name: 'fresh',
					files: [blankFile({ name: 'a' }), blankFile({ name: 'b' })],
				},
			],
			expected: [{ dialecteId: 'scl', name: 'fresh', state: 'new' }],
		},
		'its database named, no SQLite page in it yet → new': {
			projects: [
				{
					dialecteId: 'scl',
					name: 'opened',
					files: [
						poolFile({
							name: 'a',
							head: head({ path: POOL_FILE, flags: MAIN_DB, size: HEADER_BYTES }),
						}),
					],
				},
			],
			expected: [{ dialecteId: 'scl', name: 'opened', state: 'new' }],
		},
		'a file the browser refuses once (its engine writing) → read again: current': {
			projects: [
				{
					dialecteId: 'scl',
					name: 'busy',
					files: [database({ version: LAYOUT_VERSION, failures: 1 })],
				},
			],
			expected: [{ dialecteId: 'scl', name: 'busy', state: 'current' }],
		},
		'a file the browser refuses every time → unknown, never lost': {
			projects: [
				{
					dialecteId: 'scl',
					name: 'held',
					files: [database({ version: LAYOUT_VERSION, failures: 99 })],
				},
			],
			expected: [{ dialecteId: 'scl', name: 'held', state: 'unknown' }],
		},
		'names and dialecte ids holding `/` and `%` → read back as written, two projects': {
			projects: [
				{ dialecteId: 'scl/v2019C1', name: 'a/b', files: [database({ version: LAYOUT_VERSION })] },
				{ dialecteId: 'scl/v2019C1', name: '100%', files: [database({ version: LAYOUT_VERSION })] },
			],
			expected: [
				{ dialecteId: 'scl/v2019C1', name: '100%', state: 'current' },
				{ dialecteId: 'scl/v2019C1', name: 'a/b', state: 'current' },
			],
		},
		'one dialecte asked → its projects only': {
			projects: [
				{ dialecteId: 'scl', name: 'north', files: [database({ version: LAYOUT_VERSION })] },
				{ dialecteId: 'nsd', name: 'lib', files: [database({ version: LAYOUT_VERSION })] },
			],
			dialecteId: 'nsd',
			expected: [{ dialecteId: 'nsd', name: 'lib', state: 'current' }],
		},
		'no pool directory yet → none': { projects: [], expected: [] },
		'a directory whose name decodes to nothing (`%FF`) → not listed': {
			projects: [
				{
					dialecteId: 'scl',
					name: 'broken',
					directoryName: '%FF',
					files: [database({ version: LAYOUT_VERSION })],
				},
			],
			expected: [],
		},
		'a database named whose data is no SQLite file → new': {
			projects: [
				{
					dialecteId: 'scl',
					name: 'garbled',
					files: [
						poolFile({ name: 'a', head: head({ path: POOL_FILE, flags: MAIN_DB, size: DATA }) }),
					],
				},
			],
			expected: [{ dialecteId: 'scl', name: 'garbled', state: 'new' }],
		},
		'a pool removed while it is listed (destroyed in another tab) → not listed, the others listed':
			{
				projects: [
					{
						dialecteId: 'scl',
						name: 'gone',
						vanished: true,
						files: [database({ version: LAYOUT_VERSION })],
					},
					{ dialecteId: 'scl', name: 'kept', files: [database({ version: LAYOUT_VERSION })] },
				],
				expected: [{ dialecteId: 'scl', name: 'kept', state: 'current' }],
			},
		'a pool whose files the browser refuses to open → unknown': {
			projects: [
				{
					dialecteId: 'scl',
					name: 'refused',
					opaqueRefused: true,
					files: [database({ version: LAYOUT_VERSION })],
				},
			],
			expected: [{ dialecteId: 'scl', name: 'refused', state: 'unknown' }],
		},
		'a directory the library never names so (`%41`, read as `A`) → not listed: no destroy by name would reach it':
			{
				projects: [
					{
						dialecteId: 'scl',
						name: 'A',
						directoryName: '%41',
						files: [database({ version: LAYOUT_VERSION })],
					},
				],
				expected: [],
			},
	}
	for (const [description, { projects, dialecteId, expected }] of Object.entries(testCases)) {
		it(description, async () => {
			const listed = await listProjectsIn({ root: originWith({ projects }), dialecteId })
			expect(
				listed.map(function shape({ dialecteId: listedDialecte, name, state }) {
					return { dialecteId: listedDialecte, name, state }
				}),
			).toEqual(expected)
		})
	}

	it('a project → the bytes of its files and the time the last one was written', async () => {
		const [listed] = await listProjectsIn({
			root: originWith({
				projects: [
					{
						dialecteId: 'scl',
						name: 'sized',
						files: [
							database({ version: LAYOUT_VERSION, lastModified: 5_000 }),
							blankFile({ name: 'b' }),
						],
					},
				],
			}),
		})
		expect(listed).toMatchObject({ bytes: DATA + HEADER_BYTES, lastModified: 5_000 })
	})
})
