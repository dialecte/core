import { ENGINE_IDLE_CLOSE_MS } from '../engine/hub/hub.constants'
import { projectKeyOf } from '../engine/project-key'
import { listProjects } from './list-projects'
import { namesDatabase } from './runtime/pool-header'
import {
	OPAQUE_DIRECTORY,
	POOL_FILE_HEADER,
	POOL_ROOT_DIRECTORY,
} from './runtime/runtime.constants'
import { isEngineLockFree, TEST_ENGINE_URL } from './runtime/runtime.fixtures'
import { ENGINE_WORKER_CASE_TIMEOUT_MS } from './runtime/runtime.fixtures.constants'

import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { createProjectFactory } from '@/dialecte'
import { toDialecteError } from '@/errors'
import { TEST_DIALECTE } from '@/test'

import type { ProjectListing } from './list-projects.types'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

/** Core's test dialecte as a dialecte package exports it, its engine worker beside. */
const createTestProject = createProjectFactory({
	dialecte: TEST_DIALECTE,
	engineUrl: TEST_ENGINE_URL,
})

function uniqueName(): string {
	return `listed-${crypto.randomUUID()}`
}

/** A project of the test dialecte made on SQLite storage, a document in it, closed; destroyed after the case. */
async function madeProject(params: { name: string }): Promise<void> {
	const project = await createTestProject({ storage: { type: 'sqlite' } }).open(params.name)
	await project.initEmptyDocument()
	await project.close()
	destroyedAfter({ name: params.name })
}

function destroyedAfter(params: { name: string }): void {
	onTestFinished(async function destroyLeft() {
		const listed = await listedAs({ name: params.name })
		if (listed) await createTestProject.destroyProject({ name: params.name })
	})
}

/** The test dialecte's project of that name as listed, if it is. */
async function listedAs(params: { name: string }): Promise<ProjectListing | undefined> {
	const listed = await listProjects({ dialecteId: TEST_DIALECTE.id })
	return listed.find(function named(project) {
		return project.name === params.name
	})
}

/** Where the project's pool files are on the origin's private file system (sqlite-wasm's `.opaque` directory). */
async function poolOf(params: { name: string }): Promise<FileSystemDirectoryHandle> {
	const [dialecte, project] = projectKeyOf({
		dialecteId: TEST_DIALECTE.id,
		project: params.name,
	}).split('/')
	const root = await navigator.storage.getDirectory()
	const pools = await root.getDirectoryHandle(POOL_ROOT_DIRECTORY, { create: true })
	const dialecteDirectory = await pools.getDirectoryHandle(dialecte!, { create: true })
	const pool = await dialecteDirectory.getDirectoryHandle(project!, { create: true })
	return pool.getDirectoryHandle(OPAQUE_DIRECTORY, { create: true })
}

/**
 * `bytes` written over the project's database file at `offset` (from the start of the file), once its engine let it
 * go (an engine with no view keeps its files a few seconds).
 */
async function overwriteDatabase(params: {
	name: string
	offset: number
	bytes: Uint8Array
}): Promise<void> {
	await expect
		.poll(
			function engineGone() {
				return isEngineLockFree({ project: params.name, dialecteId: TEST_DIALECTE.id })
			},
			{ timeout: ENGINE_IDLE_CLOSE_MS * 3, interval: 100 },
		)
		.toBe(true)
	const pool = await poolOf(params)
	for await (const entry of pool.values()) {
		if (entry.kind !== 'file') continue
		const file = await entry.getFile()
		const header = new Uint8Array(await file.slice(0, POOL_FILE_HEADER.headBytes).arrayBuffer())
		if (!namesDatabase({ size: file.size, header })) continue
		// a lock let go does not mean every handle closed yet: the write is tried until the file takes it
		await expect
			.poll(
				function written() {
					return writeAt({ entry, offset: params.offset, bytes: params.bytes })
				},
				{ timeout: ENGINE_IDLE_CLOSE_MS * 3, interval: 100 },
			)
			.toBe(true)
		return
	}
	throw new Error(`no database in the pool of "${params.name}"`)
}

/** `bytes` written into the file at `offset`; false while another handle holds the file. */
async function writeAt(params: {
	entry: FileSystemFileHandle
	offset: number
	bytes: Uint8Array
}): Promise<boolean> {
	try {
		const writable = await params.entry.createWritable({ keepExistingData: true })
		await writable.write({
			type: 'write',
			position: params.offset,
			data: params.bytes as Uint8Array<ArrayBuffer>,
		})
		await writable.close()
		return true
	} catch (thrown) {
		if (thrown instanceof DOMException && thrown.name === 'NoModificationAllowedError') return false
		throw thrown
	}
}

function bigEndian(params: { value: number }): Uint8Array {
	const bytes = new Uint8Array(4)
	new DataView(bytes.buffer).setUint32(0, params.value)
	return bytes
}

describe('the projects on SQLite storage, read from the private file system', () => {
	it('two projects made → both listed current, of the dialecte', async () => {
		const [first, second] = [uniqueName(), uniqueName()]
		await madeProject({ name: first })
		await madeProject({ name: second })
		expect(await listedAs({ name: first })).toMatchObject({
			dialecteId: TEST_DIALECTE.id,
			state: 'current',
		})
		expect(await listedAs({ name: second })).toMatchObject({ state: 'current' })
		expect((await listedAs({ name: first }))!.bytes).toBeGreaterThan(0)
	})

	type DestroyCase = { damage: (params: { name: string }) => Promise<void>; listedAs: string }
	const destroyCases: Record<string, DestroyCase> = {
		'a database stored by another layout → outdated': {
			damage: function storeAnotherLayout({ name }) {
				return overwriteDatabase({
					name,
					offset: POOL_FILE_HEADER.bytes + 60,
					bytes: bigEndian({ value: 1 }),
				})
			},
			listedAs: 'outdated',
		},
		'a database whose pool header is damaged → lost': {
			damage: function damageHeader({ name }) {
				return overwriteDatabase({
					name,
					offset: POOL_FILE_HEADER.digestOffset,
					bytes: bigEndian({ value: 0xdeadbeef }),
				})
			},
			listedAs: 'lost',
		},
	}
	for (const [description, { damage, listedAs: state }] of Object.entries(destroyCases)) {
		it(`${description}; destroyed by name → its directory gone, no longer listed`, async () => {
			const name = uniqueName()
			await madeProject({ name })
			await damage({ name })
			expect(await listedAs({ name })).toMatchObject({ state })
			await createTestProject.destroyProject({ name })
			expect(await listedAs({ name })).toBeUndefined()
		})
	}

	it('a pool made, its files blank → new; destroyed by name → no longer listed', async () => {
		const name = uniqueName()
		const pool = await poolOf({ name })
		const file = await pool.getFileHandle('blank', { create: true })
		const writable = await file.createWritable()
		await writable.write(new Uint8Array(POOL_FILE_HEADER.bytes))
		await writable.close()
		expect(await listedAs({ name })).toMatchObject({ state: 'new' })
		await createTestProject.destroyProject({ name })
		expect(await listedAs({ name })).toBeUndefined()
	})

	it('a project open in a view → destroyed by name refused PROJECT_OPEN_ELSEWHERE, still listed', async () => {
		const name = uniqueName()
		const project = await createTestProject({ storage: { type: 'sqlite' } }).open(name)
		await project.initEmptyDocument()
		destroyedAfter({ name })
		onTestFinished(function closeProject() {
			return project.close()
		})
		const key = await createTestProject.destroyProject({ name }).then(
			function destroyed() {
				return 'destroyed'
			},
			function refused(thrown: unknown) {
				return toDialecteError(thrown)?.key
			},
		)
		expect(key).toBe('PROJECT_OPEN_ELSEWHERE')
		expect(await listedAs({ name })).toMatchObject({ state: 'current' })
	})
})
