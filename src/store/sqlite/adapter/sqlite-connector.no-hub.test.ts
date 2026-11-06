import { TEST_ENGINE_URL } from '../runtime/runtime.fixtures'
import {
	ENGINE_WORKER_CASE_TIMEOUT_MS,
	UNSERVED_DIALECTE_VERSION,
} from '../runtime/runtime.fixtures.constants'
import { refuseRealmStorage, restoreRealmStorage } from './realm-storage.fixtures'
import { createSqliteConnector } from './sqlite-connector'
import {
	expectTwoDialectesThroughOneRegistration,
	twoDialectesRegistration,
} from './sqlite-connector.fixtures'

import { afterAll, describe, expect, it, onTestFinished, vi } from 'vitest'

import { createProjectFactory } from '@/dialecte'
import { toDialecteError } from '@/errors'
import { withSqliteEngine, withSqliteStorage } from '@/store/sqlite/sqlite-storage.fixtures'
import { TEST_DIALECTE } from '@/test'

import type { SqliteEngineRegistration } from '../sqlite-storage.types'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

// before any hub is asked (this file's realm keeps no connection yet): no SharedWorker, the private file system refused
vi.stubGlobal('SharedWorker', undefined)
refuseRealmStorage()

afterAll(function restoreRealm() {
	vi.unstubAllGlobals()
	restoreRealmStorage()
})

/** The structured key a call was refused with. */
async function keyOf(params: { call: () => Promise<unknown> }): Promise<string | undefined> {
	try {
		await params.call()
	} catch (thrown) {
		return toDialecteError(thrown)?.key
	}
	return 'answered'
}

function connector(): ReturnType<typeof createSqliteConnector> {
	return createSqliteConnector({
		name: `no-hub-${crypto.randomUUID()}`,
		dialecteId: TEST_DIALECTE.id,
		dialecteVersion: TEST_DIALECTE.version,
		engine: function registeredEngine() {
			return { url: TEST_ENGINE_URL, dialectes: [TEST_DIALECTE] }
		},
	})
}

describe('a page with no hub whose private file system is refused', () => {
	type TestCase = { call: () => Promise<unknown> }
	const testCases: Record<string, TestCase> = {
		'a project connected → STORE_UNAVAILABLE': {
			call: function connect() {
				return connector().connect()
			},
		},
		'a project destroyed → STORE_UNAVAILABLE': {
			call: function destroy() {
				return connector().destroy()
			},
		},
		'a project opened through a factory, no engine registered → STORE_UNAVAILABLE first: registering would not help':
			{
				call: function openWithoutEngine() {
					withSqliteStorage()
					return createProjectFactory({ dialecte: TEST_DIALECTE })({
						storage: { type: 'sqlite' },
					}).open(`no-hub-${crypto.randomUUID()}`)
				},
			},
		'a project destroyed by name through a factory, no engine registered → STORE_UNAVAILABLE first':
			{
				call: function destroyWithoutEngine() {
					withSqliteStorage()
					return createProjectFactory({ dialecte: TEST_DIALECTE }).destroyProject({
						name: `no-hub-${crypto.randomUUID()}`,
					})
				},
			},
	}
	for (const [description, { call }] of Object.entries(testCases)) {
		it(description, async () => {
			const key = await call().then(
				function answered() {
					return 'answered'
				},
				function refused(thrown: unknown) {
					return toDialecteError(thrown)?.key
				},
			)
			expect(key).toBe('STORE_UNAVAILABLE')
		})
	}
})

describe('a page with no hub whose private file system is there', () => {
	// the file refuses the private file system for its other cases: handed back for a case, refused again once it is
	// done. onTestFinished hooks run in reverse, so the one registered first runs after the cleanups that destroy the
	// case's projects.
	function withAvailableStorage(): void {
		restoreRealmStorage()
		onTestFinished(refuseRealmStorage)
	}

	it('two dialectes of one registration, one engine worker address → a project of each imported and read back, each seeing its own hooks; one name under both dialectes stays two projects', async () => {
		withAvailableStorage()
		withSqliteEngine(twoDialectesRegistration())
		await expectTwoDialectesThroughOneRegistration({
			name: `no-hub-${crypto.randomUUID()}`,
			direct: true,
		})
	})

	it('a connector made before the engine was registered, asked after it → the registration read when it is asked: the project opens in this page', async () => {
		withAvailableStorage()
		let registration: SqliteEngineRegistration | undefined
		const made = createSqliteConnector({
			name: `no-hub-${crypto.randomUUID()}`,
			dialecteId: TEST_DIALECTE.id,
			dialecteVersion: TEST_DIALECTE.version,
			engine: function registeredLater() {
				return registration
			},
		})
		registration = { url: TEST_ENGINE_URL, dialectes: [TEST_DIALECTE] }
		onTestFinished(async function destroyProject() {
			await made.destroy()
		})
		const connecting = made.connect()
		await expect(connecting).resolves.toBeDefined()
		const link = await connecting
		onTestFinished(function closeLink() {
			return link.close()
		})
	})

	it('a project of a registered dialecte at another version → PROJECT_DIALECTE_VERSION_MISMATCH from the engine, not NOT_REGISTERED: a registration names a dialecte by id', async () => {
		withAvailableStorage()
		withSqliteEngine({ url: TEST_ENGINE_URL, dialectes: [TEST_DIALECTE] })
		const factory = createProjectFactory({
			dialecte: { ...TEST_DIALECTE, version: UNSERVED_DIALECTE_VERSION },
		})
		const key = await keyOf({
			call: function openOtherVersion() {
				return factory({ storage: { type: 'sqlite' } }).open(`no-hub-${crypto.randomUUID()}`)
			},
		})
		expect(key).toBe('PROJECT_DIALECTE_VERSION_MISMATCH')
	})
	it('a project this page runs, asked again from a registered dialecte at another version → PROJECT_DIALECTE_VERSION_MISMATCH, the engine it runs kept: a page runs one version of each dialecte', async () => {
		withAvailableStorage()
		withSqliteEngine({ url: TEST_ENGINE_URL, dialectes: [TEST_DIALECTE] })
		const name = `no-hub-${crypto.randomUUID()}`
		const running = await createProjectFactory({ dialecte: TEST_DIALECTE })({
			storage: { type: 'sqlite' },
		}).open(name)
		onTestFinished(async function destroyRunning() {
			await running.destroy()
		})
		const otherVersion = createProjectFactory({
			dialecte: { ...TEST_DIALECTE, version: UNSERVED_DIALECTE_VERSION },
		})
		const key = await keyOf({
			call: function openOtherVersion() {
				return otherVersion({ storage: { type: 'sqlite' } }).open(name)
			},
		})
		expect(key).toBe('PROJECT_DIALECTE_VERSION_MISMATCH')
		const documents = await running.getDocuments()
		expect(documents).toEqual([])
	})
})
